import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { env } from "../../config/env.js";
import { db } from "../../db/client.js";
import {
  accounts,
  auditLogs,
  plans,
  type SubscriptionEventType,
  type SubscriptionStatus,
  subscriptionEvents,
  subscriptions,
  users,
} from "../../db/schema/index.js";
import { addDays } from "./billing.constants.js";
import {
  type BillingSubscription,
  type BillingTransaction,
  expireSubscriptionIfNeeded,
} from "./billing.service.js";

/**
 * Operator-only billing actions. There is no payment gateway yet: the founder
 * collects payments manually and then runs these actions (through the admin
 * CLI) to activate, extend or change plans, and to start or end pilots.
 * Every action is transactional, writes a subscription event and an audit log.
 */

export const PILOT_PLAN_CODE = "business";

export class AdminBillingError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AdminBillingError";
  }
}

type Plan = typeof plans.$inferSelect;

export type AdminSubscriptionSummary = {
  accountId: string;
  accountName: string;
  ownerEmail: string;
  subscriptionId: string | null;
  status: SubscriptionStatus | null;
  planCode: string | null;
  isPilot: boolean;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
};

export function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

function laterOf(a: Date, b: Date | null): Date {
  return b && b.getTime() > a.getTime() ? b : a;
}

async function findAccountByOwnerEmail(tx: BillingTransaction, email: string) {
  const [row] = await tx
    .select({ account: accounts, ownerEmail: users.email })
    .from(accounts)
    .innerJoin(users, eq(users.id, accounts.ownerUserId))
    .where(and(sql`lower(${users.email}) = lower(${email.trim()})`, isNull(accounts.deletedAt)))
    .limit(1);

  if (!row) {
    throw new AdminBillingError("ACCOUNT_NOT_FOUND", `No account is owned by ${email}.`);
  }

  return row;
}

async function findPlan(tx: BillingTransaction, code: string): Promise<Plan> {
  const [plan] = await tx
    .select()
    .from(plans)
    .where(and(eq(plans.code, code), eq(plans.status, "active")))
    .limit(1);

  if (!plan) {
    throw new AdminBillingError("PLAN_NOT_FOUND", `Plan "${code}" does not exist or is retired.`);
  }

  return plan;
}

async function lockOpenSubscription(
  tx: BillingTransaction,
  accountId: string,
  now: Date,
): Promise<BillingSubscription | null> {
  const [subscription] = await tx
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.accountId, accountId), isNull(subscriptions.endedAt)))
    .for("update")
    .limit(1);

  return subscription ? expireSubscriptionIfNeeded(tx, subscription, now) : null;
}

type ChangeInput = {
  tx: BillingTransaction;
  accountId: string;
  current: BillingSubscription | null;
  values: Partial<typeof subscriptions.$inferInsert> & {
    planId: string;
    status: SubscriptionStatus;
  };
  eventType: SubscriptionEventType;
  action: string;
  metadata: Record<string, unknown>;
  now: Date;
};

async function applyChange(input: ChangeInput): Promise<BillingSubscription> {
  const { tx, accountId, current, values, now } = input;
  let saved: BillingSubscription | undefined;

  if (current) {
    [saved] = await tx
      .update(subscriptions)
      .set({ ...values, updatedAt: now })
      .where(eq(subscriptions.id, current.id))
      .returning();
  } else {
    [saved] = await tx
      .insert(subscriptions)
      .values({ ...values, accountId, startedAt: now })
      .returning();
  }

  if (!saved) {
    throw new Error("Subscription change did not return a row.");
  }

  await tx.insert(subscriptionEvents).values({
    subscriptionId: saved.id,
    eventType: input.eventType,
    fromStatus: current?.status ?? null,
    toStatus: saved.status,
    fromPlanId: current?.planId ?? null,
    toPlanId: saved.planId,
    metadata: { ...input.metadata, source: "admin_cli", effectiveAt: now.toISOString() },
  });

  await tx.insert(auditLogs).values({
    accountId,
    actorType: "admin_cli",
    action: input.action,
    entityType: "subscription",
    entityId: saved.id,
    before: current ? snapshot(current) : null,
    after: snapshot(saved),
    metadata: input.metadata,
  });

  return saved;
}

function snapshot(subscription: BillingSubscription): Record<string, unknown> {
  return {
    status: subscription.status,
    planId: subscription.planId,
    isPilot: subscription.isPilot,
    trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null,
    currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
  };
}

function assertNotPilot(subscription: BillingSubscription | null): void {
  if (subscription?.isPilot) {
    throw new AdminBillingError(
      "PILOT_ACTIVE",
      "This account is a pilot. End the pilot first (pilot:end).",
    );
  }
}

/**
 * Records a manual payment: puts the account on `planCode` as active for
 * `months` months. Paying while still active extends from the current period
 * end so no paid time is lost; paying during a trial starts the period now.
 */
export async function activatePlan(input: {
  email: string;
  planCode: string;
  months: number;
  note?: string;
  now?: Date;
}): Promise<BillingSubscription> {
  if (!Number.isInteger(input.months) || input.months < 1 || input.months > 24) {
    throw new AdminBillingError("INVALID_MONTHS", "Months must be an integer between 1 and 24.");
  }

  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const { account } = await findAccountByOwnerEmail(tx, input.email);
    const plan = await findPlan(tx, input.planCode);
    const current = await lockOpenSubscription(tx, account.id, now);
    assertNotPilot(current);

    const wasActive = current?.status === "active";
    const periodStart = wasActive ? (current.currentPeriodStart ?? now) : now;
    const periodEnd = addMonths(
      wasActive ? laterOf(now, current.currentPeriodEnd) : now,
      input.months,
    );
    let eventType: SubscriptionEventType;
    if (!current || current.status === "trial") {
      eventType = "activated";
    } else if (wasActive) {
      eventType = current.planId === plan.id ? "renewed" : "plan_changed";
    } else {
      eventType = "reactivated";
    }

    return applyChange({
      tx,
      accountId: account.id,
      current,
      values: {
        planId: plan.id,
        status: "active",
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        suspendedAt: null,
        cancelledAt: null,
      },
      eventType,
      action: "subscription.admin_activated",
      metadata: { planCode: plan.code, months: input.months, note: input.note ?? null },
      now,
    });
  });
}

/**
 * Adds free days. A trial (or an expired trial) gets its trial extended; an
 * active (or lapsed paid) subscription gets its period extended.
 */
export async function extendSubscription(input: {
  email: string;
  days: number;
  note?: string;
  now?: Date;
}): Promise<BillingSubscription> {
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > 365) {
    throw new AdminBillingError("INVALID_DAYS", "Days must be an integer between 1 and 365.");
  }

  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const { account } = await findAccountByOwnerEmail(tx, input.email);
    const current = await lockOpenSubscription(tx, account.id, now);

    if (!current) {
      throw new AdminBillingError(
        "SUBSCRIPTION_MISSING",
        "This account has no subscription yet. Use activate or pilot:start.",
      );
    }

    assertNotPilot(current);

    const isPaid = current.currentPeriodEnd !== null;
    const values = isPaid
      ? {
          planId: current.planId,
          status: "active" as const,
          currentPeriodEnd: addDays(laterOf(now, current.currentPeriodEnd), input.days),
        }
      : {
          planId: current.planId,
          status: "trial" as const,
          trialStartedAt: current.trialStartedAt ?? now,
          trialEndsAt: addDays(laterOf(now, current.trialEndsAt), input.days),
        };

    return applyChange({
      tx,
      accountId: account.id,
      current,
      values,
      eventType: current.status === "expired" ? "reactivated" : "renewed",
      action: "subscription.admin_extended",
      metadata: { days: input.days, kind: isPaid ? "period" : "trial", note: input.note ?? null },
      now,
    });
  });
}

/** Gives the account every feature for free, with no expiry. */
export async function startPilot(input: {
  email: string;
  note?: string;
  now?: Date;
}): Promise<BillingSubscription> {
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const { account } = await findAccountByOwnerEmail(tx, input.email);
    const plan = await findPlan(tx, PILOT_PLAN_CODE);
    const current = await lockOpenSubscription(tx, account.id, now);

    if (current?.isPilot) {
      throw new AdminBillingError("PILOT_ALREADY_ACTIVE", "This account is already a pilot.");
    }

    return applyChange({
      tx,
      accountId: account.id,
      current,
      values: {
        planId: plan.id,
        status: "active",
        isPilot: true,
        currentPeriodStart: now,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        suspendedAt: null,
        cancelledAt: null,
      },
      eventType: current ? "plan_changed" : "activated",
      action: "subscription.pilot_started",
      metadata: { pilot: true, planCode: plan.code, note: input.note ?? null },
      now,
    });
  });
}

/**
 * Ends a pilot without cutting the customer off: the account moves to the
 * trial plan with a fresh trial (TRIAL_DURATION_DAYS by default) so it has
 * time to pay manually before losing access.
 */
export async function endPilot(input: {
  email: string;
  trialDays?: number;
  note?: string;
  now?: Date;
}): Promise<BillingSubscription> {
  const trialDays = input.trialDays ?? env.TRIAL_DURATION_DAYS;

  if (!Number.isInteger(trialDays) || trialDays < 0 || trialDays > 365) {
    throw new AdminBillingError("INVALID_DAYS", "Trial days must be an integer between 0 and 365.");
  }

  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const { account } = await findAccountByOwnerEmail(tx, input.email);
    const current = await lockOpenSubscription(tx, account.id, now);

    if (!current?.isPilot) {
      throw new AdminBillingError("NOT_A_PILOT", "This account is not a pilot.");
    }

    const plan = await findPlan(tx, env.TRIAL_PLAN_CODE);

    return applyChange({
      tx,
      accountId: account.id,
      current,
      values: {
        planId: plan.id,
        status: trialDays > 0 ? "trial" : "expired",
        isPilot: false,
        trialStartedAt: now,
        trialEndsAt: addDays(now, trialDays),
        currentPeriodStart: null,
        currentPeriodEnd: null,
      },
      eventType: "plan_changed",
      action: "subscription.pilot_ended",
      metadata: { pilot: false, planCode: plan.code, trialDays, note: input.note ?? null },
      now,
    });
  });
}

export async function listSubscriptions(filter?: {
  email?: string;
}): Promise<AdminSubscriptionSummary[]> {
  const rows = await db
    .select({
      accountId: accounts.id,
      accountName: accounts.name,
      ownerEmail: users.email,
      subscriptionId: subscriptions.id,
      status: subscriptions.status,
      planCode: plans.code,
      isPilot: subscriptions.isPilot,
      trialEndsAt: subscriptions.trialEndsAt,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
    })
    .from(accounts)
    .innerJoin(users, eq(users.id, accounts.ownerUserId))
    .leftJoin(
      subscriptions,
      and(eq(subscriptions.accountId, accounts.id), isNull(subscriptions.endedAt)),
    )
    .leftJoin(plans, eq(plans.id, subscriptions.planId))
    .where(
      and(
        isNull(accounts.deletedAt),
        filter?.email ? sql`lower(${users.email}) = lower(${filter.email.trim()})` : undefined,
      ),
    )
    .orderBy(asc(users.email));

  const now = Date.now();

  // Expiry is applied lazily on read elsewhere; reflect it here without writing.
  return rows.map((row) => {
    const lapsed =
      (row.status === "trial" && row.trialEndsAt !== null && row.trialEndsAt.getTime() <= now) ||
      (row.status === "active" &&
        row.currentPeriodEnd !== null &&
        row.currentPeriodEnd.getTime() <= now);
    return { ...row, status: lapsed ? "expired" : row.status, isPilot: row.isPilot ?? false };
  });
}

/**
 * Marks a user's email as verified. Used while there is no transactional
 * email provider, so onboarded customers are not blocked on a link.
 */
export async function verifyUserEmail(input: { email: string; now?: Date }): Promise<void> {
  const now = input.now ?? new Date();

  await db.transaction(async (tx) => {
    const [user] = await tx
      .update(users)
      .set({
        emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, ${now.toISOString()}::timestamptz)`,
        updatedAt: now,
      })
      .where(sql`lower(${users.email}) = lower(${input.email.trim()})`)
      .returning({ id: users.id });

    if (!user) {
      throw new AdminBillingError("USER_NOT_FOUND", `No user is registered as ${input.email}.`);
    }

    await tx.insert(auditLogs).values({
      actorType: "admin_cli",
      action: "user.admin_email_verified",
      entityType: "user",
      entityId: user.id,
      metadata: {},
    });
  });
}
