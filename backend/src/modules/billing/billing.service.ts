import { and, asc, eq, isNull } from "drizzle-orm";
import { env } from "../../config/env.js";
import { db } from "../../db/client.js";
import {
  accounts,
  planEntitlements,
  plans,
  type SubscriptionStatus,
  stores,
  subscriptionEvents,
  subscriptions,
} from "../../db/schema/index.js";
import { AppError } from "../../shared/errors/app-error.js";
import {
  isSubscriptionUsable,
  PURCHASES_ENABLED_FEATURE,
  TEAM_ENABLED_FEATURE,
  TEAM_MAX_MEMBERS_FEATURE,
} from "./billing.constants.js";

type Plan = typeof plans.$inferSelect;
type PlanEntitlement = typeof planEntitlements.$inferSelect;
export type BillingSubscription = typeof subscriptions.$inferSelect;
export type BillingTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type PlanView = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: Plan["status"];
  sortOrder: number;
  priceCents: number | null;
  currency: string;
};

export type EntitlementView = {
  featureKey: string;
  enabled: boolean;
  limitValue: number | null;
  config: Record<string, unknown>;
};

export type SubscriptionView = {
  id: string;
  accountId: string;
  status: SubscriptionStatus;
  isUsable: boolean;
  plan: PlanView;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  startedAt: Date;
  endedAt: Date | null;
  cancelledAt: Date | null;
  suspendedAt: Date | null;
  cancelAtPeriodEnd: boolean;
  isPilot: boolean;
  createdAt: Date;
  updatedAt: Date;
  entitlements: EntitlementView[];
  autoPayment: {
    provider: "mercadopago";
    status: string;
    payerEmail: string | null;
    nextPaymentAt: Date | null;
    planCode: string | null;
  } | null;
};

export type StoreSalesDisabledReason =
  | "STORE_NOT_FOUND"
  | "STORE_INACTIVE"
  | "ACCOUNT_INACTIVE"
  | "SUBSCRIPTION_MISSING"
  | "SUBSCRIPTION_INACTIVE"
  | "PLAN_PURCHASES_DISABLED";

export type StoreSalesStatus = {
  enabled: boolean;
  reason: StoreSalesDisabledReason | null;
};

function toPlanView(plan: Plan): PlanView {
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    description: plan.description,
    status: plan.status,
    sortOrder: plan.sortOrder,
    priceCents: plan.priceCents,
    currency: plan.currency,
  };
}

function toEntitlementView(entitlement: PlanEntitlement): EntitlementView {
  return {
    featureKey: entitlement.featureKey,
    enabled: entitlement.enabled,
    limitValue: entitlement.limitValue,
    config: entitlement.config,
  };
}

function toSubscriptionView(
  subscription: BillingSubscription,
  plan: Plan,
  entitlements: PlanEntitlement[],
  mpPlanCode: string | null = null,
): SubscriptionView {
  return {
    id: subscription.id,
    accountId: subscription.accountId,
    status: subscription.status,
    isUsable: isSubscriptionUsable(subscription.status),
    plan: toPlanView(plan),
    trialStartedAt: subscription.trialStartedAt,
    trialEndsAt: subscription.trialEndsAt,
    currentPeriodStart: subscription.currentPeriodStart,
    currentPeriodEnd: subscription.currentPeriodEnd,
    startedAt: subscription.startedAt,
    endedAt: subscription.endedAt,
    cancelledAt: subscription.cancelledAt,
    suspendedAt: subscription.suspendedAt,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    isPilot: subscription.isPilot,
    createdAt: subscription.createdAt,
    updatedAt: subscription.updatedAt,
    entitlements: entitlements.map(toEntitlementView),
    autoPayment: subscription.mpPreapprovalId
      ? {
          provider: "mercadopago",
          status: subscription.mpPreapprovalStatus ?? "pending",
          payerEmail: subscription.mpPayerEmail,
          nextPaymentAt: subscription.mpNextPaymentAt,
          planCode: mpPlanCode,
        }
      : null,
  };
}

/**
 * While an automatic charge is set up, a missed or late charge keeps access for
 * a few days: Mercado Pago charges on the due date and retries failures.
 */
function graceMs(subscription: BillingSubscription): number {
  const autoPay =
    subscription.mpPreapprovalStatus === "authorized" && !subscription.cancelAtPeriodEnd;
  return autoPay ? env.BILLING_GRACE_DAYS * 24 * 60 * 60 * 1000 : 0;
}

export async function expireSubscriptionIfNeeded(
  tx: BillingTransaction,
  subscription: BillingSubscription,
  now: Date,
): Promise<BillingSubscription> {
  const trialEnded =
    subscription.status === "trial" &&
    subscription.trialEndsAt !== null &&
    subscription.trialEndsAt.getTime() + graceMs(subscription) <= now.getTime();
  const periodEnded =
    subscription.status === "active" &&
    subscription.currentPeriodEnd !== null &&
    subscription.currentPeriodEnd.getTime() + graceMs(subscription) <= now.getTime();

  if (!trialEnded && !periodEnded) {
    return subscription;
  }

  const [updated] = await tx
    .update(subscriptions)
    .set({ status: "expired", updatedAt: now })
    .where(eq(subscriptions.id, subscription.id))
    .returning();

  if (!updated) {
    throw new Error("Subscription expiry update did not return a row.");
  }

  await tx.insert(subscriptionEvents).values({
    subscriptionId: subscription.id,
    eventType: "expired",
    fromStatus: subscription.status,
    toStatus: "expired",
    fromPlanId: subscription.planId,
    toPlanId: subscription.planId,
    metadata: {
      reason: trialEnded ? "trial_ended" : "billing_period_ended",
      effectiveAt: now.toISOString(),
    },
  });

  return updated;
}

export async function getActivePlanByCode(code: string): Promise<PlanView | null> {
  const [plan] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.code, code), eq(plans.status, "active")))
    .limit(1);

  return plan ? toPlanView(plan) : null;
}

async function readAccountSubscription(
  accountId: string,
  tx: BillingTransaction,
): Promise<SubscriptionView | null> {
  const [subscription] = await tx
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.accountId, accountId), isNull(subscriptions.endedAt)))
    .for("update")
    .limit(1);

  if (!subscription) {
    return null;
  }

  const effective = await expireSubscriptionIfNeeded(tx, subscription, new Date());
  const [plan] = await tx.select().from(plans).where(eq(plans.id, effective.planId)).limit(1);

  if (!plan) {
    throw new Error("Subscription references a missing plan.");
  }

  const entitlements = await tx
    .select()
    .from(planEntitlements)
    .where(eq(planEntitlements.planId, plan.id))
    .orderBy(asc(planEntitlements.featureKey));

  let mpPlanCode: string | null = null;
  if (effective.mpPlanId) {
    const [mpPlan] = await tx
      .select({ code: plans.code })
      .from(plans)
      .where(eq(plans.id, effective.mpPlanId))
      .limit(1);
    mpPlanCode = mpPlan?.code ?? null;
  }

  return toSubscriptionView(effective, plan, entitlements, mpPlanCode);
}

export async function getAccountSubscription(
  accountId: string,
  tx?: BillingTransaction,
): Promise<SubscriptionView | null> {
  if (tx) {
    return readAccountSubscription(accountId, tx);
  }

  return db.transaction((transaction) => readAccountSubscription(accountId, transaction));
}

export async function getEffectiveEntitlements(
  accountId: string,
  tx?: BillingTransaction,
): Promise<Record<string, EntitlementView>> {
  const subscription = await getAccountSubscription(accountId, tx);

  if (!subscription || !isSubscriptionUsable(subscription.status)) {
    return {};
  }

  return Object.fromEntries(
    subscription.entitlements.map((entitlement) => [entitlement.featureKey, entitlement]),
  );
}

export async function getEffectiveEntitlement(
  accountId: string,
  featureKey: string,
  tx?: BillingTransaction,
): Promise<EntitlementView | null> {
  const entitlements = await getEffectiveEntitlements(accountId, tx);
  return entitlements[featureKey] ?? null;
}

export async function assertFeatureEnabled(
  accountId: string,
  featureKey: string,
  code: string,
  message: string,
  tx?: BillingTransaction,
): Promise<EntitlementView> {
  const entitlement = await getEffectiveEntitlement(accountId, featureKey, tx);

  if (!entitlement?.enabled) {
    throw new AppError({
      statusCode: 403,
      code,
      message,
      details: { featureKey },
    });
  }

  return entitlement;
}

export async function getTeamMemberLimit(
  accountId: string,
  tx?: BillingTransaction,
): Promise<number | null> {
  const entitlement = await getEffectiveEntitlement(accountId, TEAM_MAX_MEMBERS_FEATURE, tx);

  if (!entitlement?.enabled) {
    return 0;
  }

  // A null limit means explicitly unlimited.
  return entitlement.limitValue;
}

export async function assertTeamMemberCapacity(
  accountId: string,
  currentMemberCount: number,
  tx?: BillingTransaction,
): Promise<void> {
  const limit = await getTeamMemberLimit(accountId, tx);

  if (limit !== null && currentMemberCount >= limit) {
    throw new AppError({
      statusCode: 409,
      code: "TEAM_MEMBER_LIMIT_REACHED",
      message: "The team member limit for this plan has been reached.",
      details: { limit, current: currentMemberCount },
    });
  }
}

export async function getStoreSalesStatus(storeId: string): Promise<StoreSalesStatus> {
  const [row] = await db
    .select({
      storeId: stores.id,
      storeStatus: stores.status,
      deletedAt: stores.deletedAt,
      accountId: stores.accountId,
      accountStatus: accounts.status,
    })
    .from(stores)
    .innerJoin(accounts, eq(accounts.id, stores.accountId))
    .where(eq(stores.id, storeId))
    .limit(1);

  if (!row || row.deletedAt) {
    return { enabled: false, reason: "STORE_NOT_FOUND" };
  }

  if (row.storeStatus !== "active") {
    return { enabled: false, reason: "STORE_INACTIVE" };
  }

  if (row.accountStatus !== "active") {
    return { enabled: false, reason: "ACCOUNT_INACTIVE" };
  }

  const subscription = await getAccountSubscription(row.accountId);

  if (!subscription) {
    return { enabled: false, reason: "SUBSCRIPTION_MISSING" };
  }

  if (!isSubscriptionUsable(subscription.status)) {
    return { enabled: false, reason: "SUBSCRIPTION_INACTIVE" };
  }

  const purchases = subscription.entitlements.find(
    (entitlement) => entitlement.featureKey === PURCHASES_ENABLED_FEATURE,
  );

  if (!purchases?.enabled) {
    return { enabled: false, reason: "PLAN_PURCHASES_DISABLED" };
  }

  return { enabled: true, reason: null };
}

/**
 * Reusable guard for the future checkout flow. It intentionally rejects only
 * new purchases; it never deletes stores, files, orders or previously granted
 * access rights.
 */
export async function assertStorePurchasesEnabled(storeId: string): Promise<void> {
  const status = await getStoreSalesStatus(storeId);

  if (status.enabled) {
    return;
  }

  if (status.reason === "STORE_NOT_FOUND") {
    throw new AppError({
      statusCode: 404,
      code: "STORE_NOT_FOUND",
      message: "The store was not found.",
    });
  }

  throw new AppError({
    statusCode: 409,
    code: "STORE_PURCHASES_DISABLED",
    message: "The store is not accepting new purchases.",
    details: { reason: status.reason },
  });
}

export async function assertTeamFeatureEnabled(
  accountId: string,
  tx?: BillingTransaction,
): Promise<void> {
  await assertFeatureEnabled(
    accountId,
    TEAM_ENABLED_FEATURE,
    "TEAM_FEATURE_DISABLED",
    "The team feature is not enabled for this account's plan.",
    tx,
  );
}
