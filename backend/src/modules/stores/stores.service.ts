import { and, count, desc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { env } from "../../config/env.js";
import { db } from "../../db/client.js";
import {
  accounts,
  planEntitlements,
  plans,
  type StorePublicationStatus,
  type StoreRole,
  type StoreStatus,
  storeDomains,
  storeMemberships,
  stores,
  subscriptionEvents,
  subscriptions,
} from "../../db/schema/index.js";
import { isUniqueViolation } from "../../shared/db/errors.js";
import { AppError } from "../../shared/errors/app-error.js";
import { getAccountForUser } from "../accounts/accounts.service.js";
import { recordAuditEvent } from "../audit/audit.service.js";
import { addDays, isSubscriptionUsable, STORES_MAX_FEATURE } from "../billing/billing.constants.js";
import { expireSubscriptionIfNeeded, getStoreSalesStatus } from "../billing/billing.service.js";
import type { StoreAccess } from "./store-access.js";
import {
  buildPlatformHostname,
  isReservedStoreSlug,
  normalizeStoreSlug,
} from "./stores.constants.js";
import type { CreateStoreInput, UpdateStoreInput } from "./stores.schemas.js";

type Store = typeof stores.$inferSelect;

export type StoreView = {
  id: string;
  accountId: string;
  name: string;
  slug: string;
  status: StoreStatus;
  publicationStatus: StorePublicationStatus;
  primaryHostname: string | null;
  role: StoreRole;
  createdAt: Date;
  updatedAt: Date;
};

export type PublicStoreView = {
  id: string;
  name: string;
  slug: string;
  publicationStatus: StorePublicationStatus;
  purchasesEnabled: boolean;
};

function toStoreView(store: Store, role: StoreRole, primaryHostname: string | null): StoreView {
  return {
    id: store.id,
    accountId: store.accountId,
    name: store.name,
    slug: store.slug,
    status: store.status,
    publicationStatus: store.publicationStatus,
    primaryHostname,
    role,
    createdAt: store.createdAt,
    updatedAt: store.updatedAt,
  };
}

export function storeViewFromAccess(access: StoreAccess): StoreView {
  return toStoreView(access.store, access.role, access.primaryHostname);
}

async function assertSlugAvailable(slug: string): Promise<void> {
  if (isReservedStoreSlug(slug)) {
    throw new AppError({
      statusCode: 400,
      code: "SLUG_RESERVED",
      message: "This store slug is reserved.",
    });
  }

  const [existing] = await db
    .select({ id: stores.id })
    .from(stores)
    .where(and(sql`lower(${stores.slug}) = ${slug}`, isNull(stores.deletedAt)))
    .limit(1);

  if (existing) {
    throw new AppError({
      statusCode: 409,
      code: "SLUG_TAKEN",
      message: "This store slug is already in use.",
    });
  }
}

export async function getAccessibleStores(userId: string): Promise<StoreView[]> {
  const rows = await db
    .select({
      id: stores.id,
      accountId: stores.accountId,
      name: stores.name,
      slug: stores.slug,
      status: stores.status,
      publicationStatus: stores.publicationStatus,
      createdAt: stores.createdAt,
      updatedAt: stores.updatedAt,
      role: sql<StoreRole>`case when ${accounts.ownerUserId} = ${userId} then 'OWNER' else ${storeMemberships.role} end`,
      primaryHostname: storeDomains.hostname,
    })
    .from(stores)
    .innerJoin(accounts, eq(accounts.id, stores.accountId))
    .leftJoin(
      storeMemberships,
      and(
        eq(storeMemberships.storeId, stores.id),
        eq(storeMemberships.userId, userId),
        eq(storeMemberships.status, "active"),
      ),
    )
    .leftJoin(
      storeDomains,
      and(eq(storeDomains.storeId, stores.id), eq(storeDomains.isPrimary, true)),
    )
    .where(
      and(
        isNull(stores.deletedAt),
        or(eq(accounts.ownerUserId, userId), isNotNull(storeMemberships.id)),
      ),
    )
    .orderBy(desc(stores.createdAt));

  return rows.map((row) => ({
    id: row.id,
    accountId: row.accountId,
    name: row.name,
    slug: row.slug,
    status: row.status,
    publicationStatus: row.publicationStatus,
    primaryHostname: row.primaryHostname ?? null,
    role: row.role,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

export async function createStore(userId: string, input: CreateStoreInput): Promise<StoreView> {
  const account = await getAccountForUser(userId);

  if (!account) {
    throw new AppError({
      statusCode: 409,
      code: "ACCOUNT_REQUIRED",
      message: "Create an account before creating a store.",
    });
  }

  if (account.status !== "active") {
    throw new AppError({
      statusCode: 403,
      code: "ACCOUNT_INACTIVE",
      message: "The account cannot create stores in its current state.",
    });
  }

  const slug = normalizeStoreSlug(input.slug);
  await assertSlugAvailable(slug);

  const hostname = buildPlatformHostname(slug);
  const now = new Date();

  let created: Store;
  let startedTrial: { id: string; planCode: string } | null = null;

  try {
    const outcome = await db.transaction(async (tx) => {
      // Serialize store creation per account so two concurrent requests cannot
      // both observe the same remaining capacity.
      const [lockedAccount] = await tx
        .select()
        .from(accounts)
        .where(eq(accounts.id, account.id))
        .for("update")
        .limit(1);

      if (lockedAccount?.status !== "active" || lockedAccount.deletedAt) {
        throw new AppError({
          statusCode: 403,
          code: "ACCOUNT_INACTIVE",
          message: "The account cannot create stores in its current state.",
        });
      }

      let [subscription] = await tx
        .select()
        .from(subscriptions)
        .where(and(eq(subscriptions.accountId, account.id), isNull(subscriptions.endedAt)))
        .for("update")
        .limit(1);

      let trialStarted: { id: string; planCode: string } | null = null;

      if (subscription) {
        if (input.planCode) {
          const [requestedPlan] = await tx
            .select({ id: plans.id })
            .from(plans)
            .where(and(eq(plans.code, input.planCode), eq(plans.status, "active")))
            .limit(1);

          if (!requestedPlan) {
            throw new AppError({
              statusCode: 400,
              code: "PLAN_NOT_FOUND",
              message: "The requested plan is not available.",
            });
          }

          if (requestedPlan.id !== subscription.planId) {
            throw new AppError({
              statusCode: 409,
              code: "PLAN_CHANGE_NOT_ALLOWED",
              message: "The plan can only be selected when the trial subscription is created.",
            });
          }
        }

        subscription = await expireSubscriptionIfNeeded(tx, subscription, now);
      } else {
        const planCode = input.planCode ?? env.TRIAL_PLAN_CODE;
        const [plan] = await tx
          .select()
          .from(plans)
          .where(and(eq(plans.code, planCode), eq(plans.status, "active")))
          .limit(1);

        if (!plan) {
          throw new AppError({
            statusCode: 400,
            code: "PLAN_NOT_FOUND",
            message: "The requested plan is not available.",
          });
        }

        const trialEndsAt = addDays(now, env.TRIAL_DURATION_DAYS);
        const [createdSubscription] = await tx
          .insert(subscriptions)
          .values({
            accountId: account.id,
            planId: plan.id,
            status: "trial",
            trialStartedAt: now,
            trialEndsAt,
            startedAt: now,
          })
          .returning();

        if (!createdSubscription) {
          throw new Error("Subscription insert did not return a row.");
        }

        await tx.insert(subscriptionEvents).values({
          subscriptionId: createdSubscription.id,
          eventType: "trial_started",
          toStatus: "trial",
          toPlanId: plan.id,
          actorUserId: userId,
          metadata: {
            source: "first_store",
            planCode: plan.code,
            trialEndsAt: trialEndsAt.toISOString(),
          },
        });

        subscription = createdSubscription;
        trialStarted = { id: createdSubscription.id, planCode: plan.code };
      }

      if (!isSubscriptionUsable(subscription.status)) {
        throw new AppError({
          statusCode: 403,
          code: "SUBSCRIPTION_INACTIVE",
          message: "The account subscription does not allow creating stores.",
          details: { status: subscription.status },
        });
      }

      const [storeLimitEntitlement] = await tx
        .select()
        .from(planEntitlements)
        .where(
          and(
            eq(planEntitlements.planId, subscription.planId),
            eq(planEntitlements.featureKey, STORES_MAX_FEATURE),
          ),
        )
        .limit(1);

      const limit = storeLimitEntitlement?.enabled ? storeLimitEntitlement.limitValue : 0;

      const [storeCount] = await tx
        .select({ value: count() })
        .from(stores)
        .where(and(eq(stores.accountId, account.id), isNull(stores.deletedAt)));

      const currentStores = Number(storeCount?.value ?? 0);

      if (limit !== null && currentStores >= limit) {
        throw new AppError({
          statusCode: 409,
          code: "STORE_LIMIT_REACHED",
          message: "The store limit for this account's plan has been reached.",
          details: { limit, current: currentStores },
        });
      }

      const [store] = await tx
        .insert(stores)
        .values({
          accountId: account.id,
          name: input.name,
          slug,
          createdByUserId: userId,
        })
        .returning();

      if (!store) {
        throw new Error("Store insert did not return a row.");
      }

      await tx.insert(storeMemberships).values({
        storeId: store.id,
        userId,
        role: "OWNER",
        status: "active",
        acceptedAt: now,
      });

      await tx.insert(storeDomains).values({
        storeId: store.id,
        hostname,
        type: "platform_subdomain",
        verificationStatus: "verified",
        isPrimary: true,
        verifiedAt: now,
      });

      return { store, trialStarted };
    });

    created = outcome.store;
    startedTrial = outcome.trialStarted;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError({
        statusCode: 409,
        code: "SLUG_TAKEN",
        message: "This store slug is already in use.",
      });
    }

    throw error;
  }

  await recordAuditEvent({
    action: "store.created",
    actorUserId: userId,
    accountId: account.id,
    storeId: created.id,
    entityType: "store",
    entityId: created.id,
    after: {
      name: created.name,
      slug: created.slug,
      status: created.status,
      publicationStatus: created.publicationStatus,
    },
    metadata: { primaryHostname: hostname },
  });

  if (startedTrial) {
    await recordAuditEvent({
      action: "subscription.trial_started",
      actorUserId: userId,
      accountId: account.id,
      entityType: "subscription",
      entityId: startedTrial.id,
      after: { status: "trial", planCode: startedTrial.planCode },
      metadata: { source: "first_store" },
    });
  }

  return toStoreView(created, "OWNER", hostname);
}

export async function updateStore(
  userId: string,
  access: StoreAccess,
  input: UpdateStoreInput,
): Promise<StoreView> {
  if (access.role !== "OWNER" && access.role !== "ADMIN") {
    throw new AppError({
      statusCode: 403,
      code: "INSUFFICIENT_STORE_ROLE",
      message: "Only owners and administrators can update the store.",
    });
  }

  const nextSlug = input.slug ? normalizeStoreSlug(input.slug) : access.store.slug;
  const slugChanged = nextSlug !== access.store.slug;

  if (slugChanged && access.role !== "OWNER") {
    throw new AppError({
      statusCode: 403,
      code: "OWNER_REQUIRED",
      message: "Only the store owner can change the slug.",
    });
  }

  if (slugChanged) {
    await assertSlugAvailable(nextSlug);
  }

  const nextHostname = slugChanged
    ? buildPlatformHostname(nextSlug)
    : (access.primaryHostname ?? buildPlatformHostname(access.store.slug));
  const now = new Date();

  let updated: Store;

  try {
    updated = await db.transaction(async (tx) => {
      const [store] = await tx
        .update(stores)
        .set({
          name: input.name ?? access.store.name,
          slug: nextSlug,
          updatedAt: now,
        })
        .where(eq(stores.id, access.store.id))
        .returning();

      if (!store) {
        throw new Error("Store update did not return a row.");
      }

      if (slugChanged) {
        const [domain] = await tx
          .update(storeDomains)
          .set({ hostname: nextHostname, updatedAt: now })
          .where(
            and(
              eq(storeDomains.storeId, access.store.id),
              eq(storeDomains.type, "platform_subdomain"),
              eq(storeDomains.isPrimary, true),
            ),
          )
          .returning({ id: storeDomains.id });

        if (!domain) {
          await tx.insert(storeDomains).values({
            storeId: access.store.id,
            hostname: nextHostname,
            type: "platform_subdomain",
            verificationStatus: "verified",
            isPrimary: true,
            verifiedAt: now,
          });
        }
      }

      return store;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError({
        statusCode: 409,
        code: "SLUG_TAKEN",
        message: "This store slug is already in use.",
      });
    }

    throw error;
  }

  await recordAuditEvent({
    action: "store.updated",
    actorUserId: userId,
    accountId: access.account.id,
    storeId: updated.id,
    entityType: "store",
    entityId: updated.id,
    before: {
      name: access.store.name,
      slug: access.store.slug,
      primaryHostname: access.primaryHostname,
    },
    after: {
      name: updated.name,
      slug: updated.slug,
      primaryHostname: nextHostname,
    },
  });

  return toStoreView(updated, access.role, nextHostname);
}

export async function resolveStoreByHostname(hostname: string): Promise<PublicStoreView | null> {
  const [row] = await db
    .select({
      id: stores.id,
      name: stores.name,
      slug: stores.slug,
      publicationStatus: stores.publicationStatus,
    })
    .from(storeDomains)
    .innerJoin(stores, eq(stores.id, storeDomains.storeId))
    .where(
      and(
        eq(sql`lower(${storeDomains.hostname})`, hostname),
        eq(storeDomains.verificationStatus, "verified"),
        eq(stores.status, "active"),
        isNull(stores.deletedAt),
      ),
    )
    .limit(1);

  if (!row) {
    return null;
  }

  const sales = await getStoreSalesStatus(row.id);

  return { ...row, purchasesEnabled: sales.enabled };
}
