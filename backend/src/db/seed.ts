import { and, eq, isNull } from "drizzle-orm";
import { env } from "../config/env.js";
import { addDays, DEFAULT_PLAN_DEFINITIONS } from "../modules/billing/billing.constants.js";
import { getActivePlanByCode } from "../modules/billing/billing.service.js";
import { db } from "./client.js";
import {
  accounts,
  planEntitlements,
  plans,
  stores,
  subscriptionEvents,
  subscriptions,
} from "./schema/index.js";

/**
 * Inserts the initial commercial configuration. Existing plan rows and
 * entitlement values are preserved so operators can change limits without a
 * deployment; only missing rows are created.
 */
export async function seedDefaultPlans(): Promise<void> {
  await db.transaction(async (tx) => {
    for (const definition of DEFAULT_PLAN_DEFINITIONS) {
      const [plan] = await tx
        .insert(plans)
        .values({
          code: definition.code,
          name: definition.name,
          description: definition.description,
          sortOrder: definition.sortOrder,
        })
        .onConflictDoUpdate({
          target: plans.code,
          set: {
            name: definition.name,
            description: definition.description,
            sortOrder: definition.sortOrder,
            updatedAt: new Date(),
          },
        })
        .returning();

      if (!plan) {
        throw new Error(`Plan seed did not return a row for "${definition.code}".`);
      }

      for (const entitlement of definition.entitlements) {
        await tx
          .insert(planEntitlements)
          .values({
            planId: plan.id,
            featureKey: entitlement.featureKey,
            enabled: entitlement.enabled,
            limitValue: entitlement.limitValue,
            config: entitlement.config ?? {},
          })
          .onConflictDoNothing({
            target: [planEntitlements.planId, planEntitlements.featureKey],
          });
      }
    }
  });
}

/**
 * Gives accounts created before Phase 2 an open trial so the new guards have a
 * deterministic subscription to evaluate. New accounts start their trial when
 * they create their first store.
 */
export async function backfillTrialSubscriptions(): Promise<number> {
  const plan = await getActivePlanByCode(env.TRIAL_PLAN_CODE);

  if (!plan) {
    throw new Error(`Trial plan "${env.TRIAL_PLAN_CODE}" is not active or does not exist.`);
  }

  const accountRows = await db
    .selectDistinct({ accountId: stores.accountId })
    .from(stores)
    .innerJoin(accounts, eq(accounts.id, stores.accountId))
    .where(and(isNull(stores.deletedAt), isNull(accounts.deletedAt)));

  let created = 0;

  for (const { accountId } of accountRows) {
    const [existing] = await db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(eq(subscriptions.accountId, accountId))
      .limit(1);

    if (existing) {
      continue;
    }

    const now = new Date();
    const trialEndsAt = addDays(now, env.TRIAL_DURATION_DAYS);

    await db.transaction(async (tx) => {
      const [subscription] = await tx
        .insert(subscriptions)
        .values({
          accountId,
          planId: plan.id,
          status: "trial",
          trialStartedAt: now,
          trialEndsAt,
          startedAt: now,
        })
        .returning();

      if (!subscription) {
        throw new Error("Subscription backfill did not return a row.");
      }

      await tx.insert(subscriptionEvents).values({
        subscriptionId: subscription.id,
        eventType: "trial_started",
        toStatus: "trial",
        toPlanId: plan.id,
        metadata: {
          source: "legacy_backfill",
          trialEndsAt: trialEndsAt.toISOString(),
          planCode: plan.code,
        },
      });
    });

    created += 1;
  }

  return created;
}
