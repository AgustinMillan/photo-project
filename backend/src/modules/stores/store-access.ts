import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  accounts,
  type StoreRole,
  storeDomains,
  storeMemberships,
  stores,
} from "../../db/schema/index.js";
import { AppError } from "../../shared/errors/app-error.js";
import { assertTeamFeatureEnabled } from "../billing/billing.service.js";

type Store = typeof stores.$inferSelect;
type Account = typeof accounts.$inferSelect;

export type StoreAccess = {
  userId: string;
  store: Store;
  account: Account;
  role: StoreRole;
  primaryHostname: string | null;
};

export async function getStoreAccess(userId: string, storeId: string): Promise<StoreAccess | null> {
  const [row] = await db
    .select({
      store: stores,
      account: accounts,
      membershipId: storeMemberships.id,
      role: storeMemberships.role,
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
    .where(and(eq(stores.id, storeId), isNull(stores.deletedAt)))
    .limit(1);

  if (!row) {
    return null;
  }

  const isOwner = row.account.ownerUserId === userId;

  if (!isOwner && !row.membershipId) {
    return null;
  }

  // A suspended or closed account loses administrative access even if a
  // historical membership row is still active.
  if (row.account.status !== "active") {
    return null;
  }

  if (!isOwner && !row.role) {
    return null;
  }

  return {
    userId,
    store: row.store,
    account: row.account,
    role: isOwner ? "OWNER" : (row.role as StoreRole),
    primaryHostname: row.primaryHostname ?? null,
  };
}

export async function requireStoreAccess(
  userId: string,
  storeId: string,
  allowedRoles?: readonly StoreRole[],
): Promise<StoreAccess> {
  const access = await getStoreAccess(userId, storeId);

  if (!access) {
    // A 404 avoids confirming the existence of stores outside the caller's
    // tenant scope.
    throw new AppError({
      statusCode: 404,
      code: "STORE_NOT_FOUND",
      message: "The store was not found.",
    });
  }

  if (allowedRoles && !allowedRoles.includes(access.role)) {
    throw new AppError({
      statusCode: 403,
      code: "INSUFFICIENT_STORE_ROLE",
      message: "Your store role does not allow this operation.",
    });
  }

  return access;
}

export async function assertTeamManagement(access: StoreAccess): Promise<void> {
  if (access.role !== "OWNER" && access.role !== "ADMIN") {
    throw new AppError({
      statusCode: 403,
      code: "INSUFFICIENT_STORE_ROLE",
      message: "Only owners and administrators can manage the team.",
    });
  }

  await assertTeamFeatureEnabled(access.account.id);
}
