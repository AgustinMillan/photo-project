import { and, asc, desc, eq, gt, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { env } from "../../config/env.js";
import { db } from "../../db/client.js";
import {
  accounts,
  planEntitlements,
  plans,
  subscriptionEvents,
  subscriptionPayments,
  subscriptions,
  users,
} from "../../db/schema/index.js";
import { sendEmail } from "../../shared/email/email.service.js";
import { AppError } from "../../shared/errors/app-error.js";
import { logger } from "../../shared/logger.js";
import {
  createPreapproval,
  getAuthorizedPayment,
  getPreapproval,
  type MpAuthorizedPayment,
  type MpPreapproval,
  mercadoPagoConfigured,
  searchAuthorizedPayments,
  searchPreapprovals,
  updatePreapproval,
} from "../payments/mercadopago.client.js";
import { addMonths } from "./billing.admin.js";
import { STATS_ENABLED_FEATURE } from "./billing.constants.js";
import { getAccountSubscription, type SubscriptionView } from "./billing.service.js";

/**
 * Monthly platform fee charged with Mercado Pago subscriptions ("preapproval")
 * to the account that owns the Mercado Pago app. Every state change is read back
 * from Mercado Pago and applied idempotently, so webhooks, the return redirect
 * and manual syncs can all run in any order and any number of times.
 */

type Subscription = typeof subscriptions.$inferSelect;
type Plan = typeof plans.$inferSelect;

export const SUBSCRIPTION_REFERENCE_PREFIX = "sub:";

export type SellablePlan = {
  code: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  features: { stats: boolean };
};

function referenceFor(subscriptionId: string): string {
  return `${SUBSCRIPTION_REFERENCE_PREFIX}${subscriptionId}`;
}

function subscriptionIdFromReference(reference: string | null | undefined): string | null {
  if (!reference?.startsWith(SUBSCRIPTION_REFERENCE_PREFIX)) return null;
  const id = reference.slice(SUBSCRIPTION_REFERENCE_PREFIX.length);
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

function formatArs(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("es-AR")}`;
}

function requireConfigured(): void {
  if (!mercadoPagoConfigured()) {
    throw new AppError({
      statusCode: 503,
      code: "BILLING_UNAVAILABLE",
      message: "Automatic billing is not configured.",
    });
  }
}

export async function listSellablePlans(): Promise<SellablePlan[]> {
  const rows = await db
    .select()
    .from(plans)
    .where(and(eq(plans.status, "active"), isNotNull(plans.priceCents)))
    .orderBy(asc(plans.sortOrder));
  const stats = await db
    .select({ planId: planEntitlements.planId, enabled: planEntitlements.enabled })
    .from(planEntitlements)
    .where(eq(planEntitlements.featureKey, STATS_ENABLED_FEATURE));
  const statsByPlan = new Map(stats.map((row) => [row.planId, row.enabled]));

  return rows.map((plan) => ({
    code: plan.code,
    name: plan.name,
    description: plan.description,
    priceCents: plan.priceCents as number,
    currency: plan.currency,
    features: { stats: statsByPlan.get(plan.id) ?? false },
  }));
}

async function requireSellablePlan(code: string): Promise<Plan> {
  const [plan] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.code, code), eq(plans.status, "active"), isNotNull(plans.priceCents)))
    .limit(1);
  if (!plan) {
    throw new AppError({ statusCode: 404, code: "PLAN_NOT_FOUND", message: "Plan not found." });
  }
  return plan;
}

async function openSubscription(accountId: string): Promise<Subscription> {
  const [subscription] = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.accountId, accountId), isNull(subscriptions.endedAt)))
    .limit(1);
  if (!subscription) {
    throw new AppError({
      statusCode: 409,
      code: "SUBSCRIPTION_MISSING",
      message: "Create your store before choosing a plan.",
    });
  }
  return subscription;
}

/** When the first automatic charge should happen: never before the paid-up date. */
function firstChargeDate(subscription: Subscription, now: Date): Date | null {
  const candidates = [
    subscription.status === "trial" ? subscription.trialEndsAt : null,
    subscription.status === "active" ? subscription.currentPeriodEnd : null,
  ].filter((date): date is Date => date !== null && date.getTime() > now.getTime() + 60 * 60_000);
  return candidates[0] ?? null;
}

export async function startSubscriptionCheckout(input: {
  accountId: string;
  actorUserId: string;
  planCode: string;
  payerEmail: string;
}): Promise<{ url: string; updated: boolean }> {
  requireConfigured();
  const plan = await requireSellablePlan(input.planCode);
  const subscription = await openSubscription(input.accountId);
  const backUrl = new URL("/app/subscription", env.APP_URL);

  if (subscription.isPilot) {
    throw new AppError({
      statusCode: 409,
      code: "SUBSCRIPTION_IS_PILOT",
      message: "Pilot accounts are not charged.",
    });
  }

  const amount = (plan.priceCents as number) / 100;
  const reason = `Galeriza · Plan ${plan.name}`;

  // Already paying: change the amount of the existing charge and the plan now.
  if (subscription.mpPreapprovalId && subscription.mpPreapprovalStatus === "authorized") {
    if (subscription.mpPlanId !== plan.id) {
      await updatePreapproval(subscription.mpPreapprovalId, {
        reason,
        auto_recurring: { transaction_amount: amount, currency_id: plan.currency },
      });
      const switchNow = subscription.status !== "trial";
      await db.transaction(async (tx) => {
        await tx
          .update(subscriptions)
          .set({
            ...(switchNow ? { planId: plan.id } : {}),
            mpPlanId: plan.id,
            updatedAt: new Date(),
          })
          .where(eq(subscriptions.id, subscription.id));
        if (switchNow && subscription.planId !== plan.id) {
          await tx.insert(subscriptionEvents).values({
            subscriptionId: subscription.id,
            eventType: "plan_changed",
            fromStatus: subscription.status,
            toStatus: subscription.status,
            fromPlanId: subscription.planId,
            toPlanId: plan.id,
            actorUserId: input.actorUserId,
            metadata: { source: "mercadopago", amount },
          });
        }
      });
    }
    backUrl.searchParams.set("mp", "updated");
    return { url: backUrl.toString(), updated: true };
  }

  backUrl.searchParams.set("mp", "return");
  const startDate = firstChargeDate(subscription, new Date());
  const preapproval = await createPreapproval({
    reason,
    external_reference: referenceFor(subscription.id),
    payer_email: input.payerEmail,
    back_url: backUrl.toString(),
    status: "pending",
    auto_recurring: {
      frequency: 1,
      frequency_type: "months",
      transaction_amount: amount,
      currency_id: plan.currency,
      ...(startDate ? { start_date: startDate.toISOString() } : {}),
    },
  });
  if (!preapproval.init_point) {
    throw new AppError({
      statusCode: 502,
      code: "PAYMENT_PROVIDER_ERROR",
      message: "Mercado Pago did not return a checkout link.",
    });
  }

  await db
    .update(subscriptions)
    .set({
      mpPreapprovalId: preapproval.id,
      mpPreapprovalStatus: preapproval.status,
      mpPayerEmail: input.payerEmail,
      mpPlanId: plan.id,
      mpNextPaymentAt: preapproval.next_payment_date
        ? new Date(preapproval.next_payment_date)
        : null,
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.id, subscription.id));

  return { url: preapproval.init_point, updated: false };
}

export async function cancelAutomaticPayment(accountId: string, actorUserId: string) {
  requireConfigured();
  const subscription = await openSubscription(accountId);
  if (!subscription.mpPreapprovalId) {
    throw new AppError({
      statusCode: 409,
      code: "AUTO_PAYMENT_MISSING",
      message: "There is no automatic payment to cancel.",
    });
  }
  if (subscription.mpPreapprovalStatus !== "cancelled") {
    await updatePreapproval(subscription.mpPreapprovalId, { status: "cancelled" });
  }
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(subscriptions)
      .set({
        mpPreapprovalStatus: "cancelled",
        cancelAtPeriodEnd: true,
        cancelledAt: subscription.cancelledAt ?? now,
        updatedAt: now,
      })
      .where(eq(subscriptions.id, subscription.id));
    await tx.insert(subscriptionEvents).values({
      subscriptionId: subscription.id,
      eventType: "cancelled",
      fromStatus: subscription.status,
      toStatus: subscription.status,
      fromPlanId: subscription.planId,
      toPlanId: subscription.planId,
      actorUserId,
      metadata: {
        source: "user",
        accessUntil: (subscription.currentPeriodEnd ?? subscription.trialEndsAt)?.toISOString(),
      },
    });
  });
  return getAccountSubscription(accountId);
}

function pickPreapproval(list: MpPreapproval[], storedId: string | null): MpPreapproval | null {
  const authorized = list.filter((item) => item.status === "authorized");
  if (authorized.length > 0) {
    return authorized.find((item) => item.id === storedId) ?? authorized[0] ?? null;
  }
  return list.find((item) => item.id === storedId) ?? list[0] ?? null;
}

async function planForAmount(amount: number | undefined): Promise<Plan | null> {
  if (amount === undefined) return null;
  const [plan] = await db
    .select()
    .from(plans)
    .where(and(isNotNull(plans.priceCents), eq(plans.priceCents, Math.round(amount * 100))))
    .orderBy(asc(plans.sortOrder))
    .limit(1);
  return plan ?? null;
}

async function ownerEmail(accountId: string): Promise<string | null> {
  const [row] = await db
    .select({ email: users.email })
    .from(accounts)
    .innerJoin(users, eq(users.id, accounts.ownerUserId))
    .where(eq(accounts.id, accountId))
    .limit(1);
  return row?.email ?? null;
}

function panelUrl(): string {
  return new URL("/app/subscription", env.APP_URL).toString();
}

async function notify(accountId: string, subject: string, lines: string[]) {
  const to = await ownerEmail(accountId);
  if (!to) return;
  const text = `${lines.join("\n\n")}\n\n${panelUrl()}`;
  const html = `${lines.map((line) => `<p>${line}</p>`).join("")}<p><a href="${panelUrl()}">Ver mi plan</a></p>`;
  sendEmail({ to, subject, text, html }).catch((error) =>
    logger.warn({ err: error }, "Billing email failed"),
  );
}

/** Applies one monthly charge. Returns true when it newly paid a period. */
async function applyCharge(subscriptionId: string, charge: MpAuthorizedPayment): Promise<boolean> {
  const paymentStatus = charge.payment?.status ?? null;
  const approved = paymentStatus === "approved";
  const failed = paymentStatus === "rejected" || charge.status === "cancelled";
  const amountCents = Math.round(charge.transaction_amount * 100);
  const chargeId = String(charge.id);

  const outcome = await db.transaction(async (tx) => {
    const [subscription] = await tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, subscriptionId))
      .for("update")
      .limit(1);
    if (!subscription) return null;

    const [existing] = await tx
      .select()
      .from(subscriptionPayments)
      .where(
        and(
          eq(subscriptionPayments.provider, "mercadopago"),
          eq(subscriptionPayments.providerChargeId, chargeId),
        ),
      )
      .limit(1);
    const now = new Date();
    const status = approved ? "approved" : (paymentStatus ?? charge.status);

    if (existing?.status === "approved") return null; // already applied
    const wasFailed = existing?.status === "rejected" || existing?.status === "cancelled";

    let periodStart: Date | null = null;
    let periodEnd: Date | null = null;
    if (approved) {
      const paidAt = charge.debit_date ? new Date(charge.debit_date) : now;
      const candidates = [paidAt];
      if (subscription.status === "trial" && subscription.trialEndsAt) {
        candidates.push(subscription.trialEndsAt);
      }
      if (subscription.status === "active" && subscription.currentPeriodEnd) {
        candidates.push(subscription.currentPeriodEnd);
      }
      periodStart = new Date(Math.max(...candidates.map((date) => date.getTime())));
      periodEnd = addMonths(periodStart, 1);
    }

    const values = {
      subscriptionId,
      planId: subscription.mpPlanId ?? subscription.planId,
      providerChargeId: chargeId,
      providerPaymentId: charge.payment?.id !== undefined ? String(charge.payment.id) : null,
      status,
      amountCents,
      currency: charge.currency_id,
      paidAt: approved ? (charge.debit_date ? new Date(charge.debit_date) : now) : null,
      periodStart,
      periodEnd,
      raw: charge as unknown as Record<string, unknown>,
      updatedAt: now,
    };
    if (existing) {
      await tx
        .update(subscriptionPayments)
        .set(values)
        .where(eq(subscriptionPayments.id, existing.id));
    } else {
      await tx.insert(subscriptionPayments).values(values);
    }

    if (approved && periodStart && periodEnd) {
      const fromStatus = subscription.status;
      await tx
        .update(subscriptions)
        .set({
          status: "active",
          planId: subscription.isPilot
            ? subscription.planId
            : (subscription.mpPlanId ?? subscription.planId),
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          suspendedAt: null,
          updatedAt: now,
        })
        .where(eq(subscriptions.id, subscription.id));
      await tx.insert(subscriptionEvents).values({
        subscriptionId,
        eventType: "payment_received",
        fromStatus,
        toStatus: "active",
        fromPlanId: subscription.planId,
        toPlanId: subscription.isPilot
          ? subscription.planId
          : (subscription.mpPlanId ?? subscription.planId),
        metadata: { chargeId, amountCents, periodEnd: periodEnd.toISOString() },
      });
      return { kind: "paid" as const, accountId: subscription.accountId, amountCents, periodEnd };
    }

    if (failed && !wasFailed) {
      await tx.insert(subscriptionEvents).values({
        subscriptionId,
        eventType: "payment_failed",
        fromStatus: subscription.status,
        toStatus: subscription.status,
        fromPlanId: subscription.planId,
        toPlanId: subscription.planId,
        metadata: { chargeId, amountCents, detail: charge.payment?.status_detail ?? null },
      });
      return { kind: "failed" as const, accountId: subscription.accountId, amountCents };
    }
    return null;
  });

  if (outcome?.kind === "paid") {
    await notify(outcome.accountId, "Recibimos tu pago de Galeriza", [
      `¡Gracias! Recibimos tu pago de ${formatArs(outcome.amountCents)}.`,
      `Tu plan queda activo hasta el ${outcome.periodEnd.toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}. El próximo mes se cobra solo.`,
    ]);
    return true;
  }
  if (outcome?.kind === "failed") {
    await notify(outcome.accountId, "No pudimos cobrar tu plan de Galeriza", [
      `Mercado Pago no pudo cobrar ${formatArs(outcome.amountCents)} de tu plan. Va a reintentar en los próximos días.`,
      "Revisá que tu tarjeta tenga saldo o cambiá el medio de pago desde Mercado Pago. Tu tienda sigue funcionando mientras tanto.",
    ]);
  }
  return false;
}

/** Reads the subscription's charge from Mercado Pago and applies it. */
export async function syncSubscription(subscriptionId: string): Promise<void> {
  if (!mercadoPagoConfigured()) return;
  const [subscription] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, subscriptionId))
    .limit(1);
  if (!subscription) return;

  const found = await searchPreapprovals(referenceFor(subscriptionId));
  if (
    subscription.mpPreapprovalId &&
    !found.some((item) => item.id === subscription.mpPreapprovalId)
  ) {
    try {
      found.push(await getPreapproval(subscription.mpPreapprovalId));
    } catch (error) {
      logger.warn({ err: error, subscriptionId }, "Could not read stored preapproval");
    }
  }
  const preapproval = pickPreapproval(found, subscription.mpPreapprovalId);
  if (!preapproval) return;

  // Never keep two live charges for the same account.
  for (const extra of found) {
    if (extra.id !== preapproval.id && extra.status === "authorized") {
      await updatePreapproval(extra.id, { status: "cancelled" }).catch((error) =>
        logger.warn(
          { err: error, preapprovalId: extra.id },
          "Could not cancel duplicate preapproval",
        ),
      );
    }
  }

  let chargedPlan: Plan | null = null;
  if (preapproval.id === subscription.mpPreapprovalId && subscription.mpPlanId) {
    const [stored] = await db
      .select()
      .from(plans)
      .where(eq(plans.id, subscription.mpPlanId))
      .limit(1);
    chargedPlan = stored ?? null;
  }
  chargedPlan ??= await planForAmount(preapproval.auto_recurring?.transaction_amount);

  await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, subscriptionId))
      .for("update")
      .limit(1);
    if (!current) return;
    const now = new Date();
    const becameAuthorized =
      preapproval.status === "authorized" &&
      !(current.mpPreapprovalId === preapproval.id && current.mpPreapprovalStatus === "authorized");
    const becameCancelled =
      (preapproval.status === "cancelled" || preapproval.status === "paused") &&
      current.mpPreapprovalStatus === "authorized" &&
      current.mpPreapprovalId === preapproval.id;

    const update: Partial<Subscription> = {
      mpPreapprovalId: preapproval.id,
      mpPreapprovalStatus: preapproval.status,
      mpPayerEmail: preapproval.payer_email ?? current.mpPayerEmail,
      mpPlanId: chargedPlan?.id ?? current.mpPlanId,
      mpNextPaymentAt: preapproval.next_payment_date
        ? new Date(preapproval.next_payment_date)
        : null,
      updatedAt: now,
    };
    if (becameAuthorized) {
      update.cancelAtPeriodEnd = false;
      update.cancelledAt = null;
      // During the trial the account keeps the trial plan; the chosen plan
      // starts with the first charge (see applyCharge).
      if (
        chargedPlan &&
        chargedPlan.id !== current.planId &&
        !current.isPilot &&
        current.status !== "trial"
      ) {
        update.planId = chargedPlan.id;
      }
    }
    if (becameCancelled) {
      update.cancelAtPeriodEnd = true;
      update.cancelledAt = current.cancelledAt ?? now;
    }
    await tx.update(subscriptions).set(update).where(eq(subscriptions.id, subscriptionId));

    if (becameAuthorized) {
      await tx.insert(subscriptionEvents).values({
        subscriptionId,
        eventType: "provider_linked",
        fromStatus: current.status,
        toStatus: current.status,
        fromPlanId: current.planId,
        toPlanId: update.planId ?? current.planId,
        metadata: { provider: "mercadopago", preapprovalId: preapproval.id },
      });
    }
    if (becameCancelled) {
      await tx.insert(subscriptionEvents).values({
        subscriptionId,
        eventType: "cancelled",
        fromStatus: current.status,
        toStatus: current.status,
        fromPlanId: current.planId,
        toPlanId: current.planId,
        metadata: { source: "mercadopago", preapprovalStatus: preapproval.status },
      });
    }
  });

  const charges = await searchAuthorizedPayments(preapproval.id);
  charges.sort(
    (a, b) =>
      new Date(a.debit_date ?? a.date_created ?? 0).getTime() -
      new Date(b.debit_date ?? b.date_created ?? 0).getTime(),
  );
  for (const charge of charges) {
    await applyCharge(subscriptionId, charge);
  }
}

export async function syncAccountSubscription(accountId: string): Promise<SubscriptionView | null> {
  const subscription = await openSubscription(accountId);
  if (subscription.mpPreapprovalId) {
    await syncSubscription(subscription.id);
  }
  return getAccountSubscription(accountId);
}

async function subscriptionIdForPreapproval(preapprovalId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(eq(subscriptions.mpPreapprovalId, preapprovalId))
    .limit(1);
  if (row) return row.id;
  const preapproval = await getPreapproval(preapprovalId);
  return subscriptionIdFromReference(preapproval.external_reference);
}

export const SUBSCRIPTION_WEBHOOK_TYPES = new Set([
  "subscription_preapproval",
  "subscription_authorized_payment",
  "preapproval",
  "authorized_payment",
]);

/** Webhook for the platform's own subscriptions (already signature-checked). */
export async function handleSubscriptionWebhook(type: string, dataId: string): Promise<string> {
  let subscriptionId: string | null = null;
  if (type === "subscription_authorized_payment" || type === "authorized_payment") {
    const charge = await getAuthorizedPayment(dataId);
    subscriptionId = await subscriptionIdForPreapproval(charge.preapproval_id);
  } else {
    subscriptionId = await subscriptionIdForPreapproval(dataId);
  }
  if (!subscriptionId) return "subscription_not_found";
  await syncSubscription(subscriptionId);
  return "synced";
}

export async function listSubscriptionPayments(accountId: string) {
  const subscription = await openSubscription(accountId);
  return db
    .select({
      id: subscriptionPayments.id,
      status: subscriptionPayments.status,
      amountCents: subscriptionPayments.amountCents,
      currency: subscriptionPayments.currency,
      paidAt: subscriptionPayments.paidAt,
      periodStart: subscriptionPayments.periodStart,
      periodEnd: subscriptionPayments.periodEnd,
      createdAt: subscriptionPayments.createdAt,
      planName: plans.name,
    })
    .from(subscriptionPayments)
    .leftJoin(plans, eq(plans.id, subscriptionPayments.planId))
    .where(eq(subscriptionPayments.subscriptionId, subscription.id))
    .orderBy(desc(subscriptionPayments.createdAt))
    .limit(24);
}

/**
 * Daily job: reminds trial accounts without automatic payment that the trial
 * ends soon, once per trial. Returns how many reminders were sent.
 */
export async function sendTrialEndingReminders(now = new Date(), daysAhead = 3): Promise<number> {
  const until = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  const due = await db
    .select({
      id: subscriptions.id,
      accountId: subscriptions.accountId,
      status: subscriptions.status,
      planId: subscriptions.planId,
      trialEndsAt: subscriptions.trialEndsAt,
    })
    .from(subscriptions)
    .where(
      and(
        isNull(subscriptions.endedAt),
        eq(subscriptions.status, "trial"),
        eq(subscriptions.isPilot, false),
        gt(subscriptions.trialEndsAt, now),
        lte(subscriptions.trialEndsAt, until),
        sql`coalesce(${subscriptions.mpPreapprovalStatus}, '') <> 'authorized'`,
        sql`not exists (select 1 from subscription_events e where e.subscription_id = ${subscriptions.id} and e.event_type = 'reminder_sent')`,
      ),
    );

  for (const row of due) {
    const ends = (row.trialEndsAt as Date).toLocaleDateString("es-AR", {
      timeZone: "America/Argentina/Buenos_Aires",
      day: "numeric",
      month: "long",
    });
    await db.insert(subscriptionEvents).values({
      subscriptionId: row.id,
      eventType: "reminder_sent",
      fromStatus: row.status,
      toStatus: row.status,
      fromPlanId: row.planId,
      toPlanId: row.planId,
      metadata: { kind: "trial_ending", trialEndsAt: (row.trialEndsAt as Date).toISOString() },
    });
    await notify(row.accountId, "Tu prueba de Galeriza termina pronto", [
      `Tu prueba gratis termina el ${ends}.`,
      "Para que tu tienda siga vendiendo, elegí tu plan y activá el pago automático con Mercado Pago. No se cobra nada hasta que termine la prueba.",
    ]);
  }
  return due.length;
}
