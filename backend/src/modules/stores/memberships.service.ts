import { and, eq, ne } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  type StoreMembershipStatus,
  type StoreRole,
  storeMemberships,
  users,
} from "../../db/schema/index.js";
import { AppError } from "../../shared/errors/app-error.js";
import { recordAuditEvent } from "../audit/audit.service.js";
import { assertTeamManagement, type StoreAccess } from "./store-access.js";
import type { UpdateStoreMemberInput } from "./stores.schemas.js";

export type StoreMemberView = {
  membershipId: string;
  userId: string;
  email: string;
  displayName: string | null;
  role: StoreRole;
  status: StoreMembershipStatus;
  acceptedAt: Date | null;
  createdAt: Date;
};

async function getMemberView(storeId: string, userId: string): Promise<StoreMemberView | null> {
  const [row] = await db
    .select({
      membershipId: storeMemberships.id,
      userId: users.id,
      email: users.email,
      displayName: users.displayName,
      role: storeMemberships.role,
      status: storeMemberships.status,
      acceptedAt: storeMemberships.acceptedAt,
      createdAt: storeMemberships.createdAt,
    })
    .from(storeMemberships)
    .innerJoin(users, eq(users.id, storeMemberships.userId))
    .where(and(eq(storeMemberships.storeId, storeId), eq(storeMemberships.userId, userId)))
    .limit(1);

  return row ?? null;
}

export async function listStoreMembers(access: StoreAccess): Promise<StoreMemberView[]> {
  await assertTeamManagement(access);

  return db
    .select({
      membershipId: storeMemberships.id,
      userId: users.id,
      email: users.email,
      displayName: users.displayName,
      role: storeMemberships.role,
      status: storeMemberships.status,
      acceptedAt: storeMemberships.acceptedAt,
      createdAt: storeMemberships.createdAt,
    })
    .from(storeMemberships)
    .innerJoin(users, eq(users.id, storeMemberships.userId))
    .where(
      and(eq(storeMemberships.storeId, access.store.id), ne(storeMemberships.status, "removed")),
    )
    .orderBy(storeMemberships.createdAt);
}

function assertTargetIsMutable(access: StoreAccess, targetUserId: string, targetRole?: StoreRole) {
  if (targetUserId === access.account.ownerUserId || targetRole === "OWNER") {
    throw new AppError({
      statusCode: 403,
      code: "OWNER_MEMBERSHIP_IMMUTABLE",
      message: "The account owner's membership cannot be changed.",
    });
  }

  if (access.role === "ADMIN" && targetRole === "ADMIN") {
    throw new AppError({
      statusCode: 403,
      code: "ADMIN_CANNOT_MANAGE_ADMINS",
      message: "Only the owner can manage administrator memberships.",
    });
  }
}

export async function updateStoreMember(
  access: StoreAccess,
  targetUserId: string,
  input: UpdateStoreMemberInput,
): Promise<StoreMemberView> {
  await assertTeamManagement(access);

  const target = await getMemberView(access.store.id, targetUserId);

  if (!target || target.status === "removed") {
    throw new AppError({
      statusCode: 404,
      code: "STORE_MEMBER_NOT_FOUND",
      message: "The store member was not found.",
    });
  }

  assertTargetIsMutable(access, targetUserId, target.role);

  if (access.role === "ADMIN" && input.role === "ADMIN") {
    throw new AppError({
      statusCode: 403,
      code: "ADMIN_CANNOT_MANAGE_ADMINS",
      message: "Only the owner can assign the administrator role.",
    });
  }

  const [updated] = await db
    .update(storeMemberships)
    .set({ role: input.role, updatedAt: new Date() })
    .where(
      and(eq(storeMemberships.storeId, access.store.id), eq(storeMemberships.userId, targetUserId)),
    )
    .returning({ id: storeMemberships.id });

  if (!updated) {
    throw new AppError({
      statusCode: 404,
      code: "STORE_MEMBER_NOT_FOUND",
      message: "The store member was not found.",
    });
  }

  await recordAuditEvent({
    action: "store.member_role_updated",
    actorUserId: access.userId,
    accountId: access.account.id,
    storeId: access.store.id,
    entityType: "store_membership",
    entityId: updated.id,
    before: { userId: target.userId, role: target.role },
    after: { userId: target.userId, role: input.role },
  });

  const result = await getMemberView(access.store.id, targetUserId);

  if (!result) {
    throw new AppError({
      statusCode: 404,
      code: "STORE_MEMBER_NOT_FOUND",
      message: "The store member was not found.",
    });
  }

  return result;
}

export async function removeStoreMember(access: StoreAccess, targetUserId: string): Promise<void> {
  await assertTeamManagement(access);

  const target = await getMemberView(access.store.id, targetUserId);

  if (!target || target.status === "removed") {
    throw new AppError({
      statusCode: 404,
      code: "STORE_MEMBER_NOT_FOUND",
      message: "The store member was not found.",
    });
  }

  assertTargetIsMutable(access, targetUserId, target.role);

  const [updated] = await db
    .update(storeMemberships)
    .set({ status: "removed", updatedAt: new Date() })
    .where(
      and(eq(storeMemberships.storeId, access.store.id), eq(storeMemberships.userId, targetUserId)),
    )
    .returning({ id: storeMemberships.id });

  if (!updated) {
    throw new AppError({
      statusCode: 404,
      code: "STORE_MEMBER_NOT_FOUND",
      message: "The store member was not found.",
    });
  }

  await recordAuditEvent({
    action: "store.member_removed",
    actorUserId: access.userId,
    accountId: access.account.id,
    storeId: access.store.id,
    entityType: "store_membership",
    entityId: updated.id,
    before: { userId: target.userId, role: target.role, status: target.status },
    after: { userId: target.userId, status: "removed" },
  });
}
