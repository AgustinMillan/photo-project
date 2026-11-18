import { and, count, desc, eq, sql } from "drizzle-orm";
import { env } from "../../config/env.js";
import { db } from "../../db/client.js";
import {
  accounts,
  type StoreInvitationStatus,
  type StoreRole,
  storeInvitations,
  storeMemberships,
  stores,
  users,
} from "../../db/schema/index.js";
import { generateOpaqueToken, hashToken } from "../../shared/auth/tokens.js";
import { isUniqueViolation } from "../../shared/db/errors.js";
import { AppError } from "../../shared/errors/app-error.js";
import { logger } from "../../shared/logger.js";
import { recordAuditEvent } from "../audit/audit.service.js";
import type { AuthUser } from "../auth/auth.service.js";
import { assertTeamFeatureEnabled, assertTeamMemberCapacity } from "../billing/billing.service.js";
import { assertTeamManagement, type StoreAccess } from "./store-access.js";
import { sendStoreInvitationEmail } from "./stores.email.js";
import type { CreateStoreInvitationInput } from "./stores.schemas.js";

type InvitationRole = Exclude<StoreRole, "OWNER">;

export type StoreInvitationView = {
  id: string;
  email: string;
  role: InvitationRole;
  status: StoreInvitationStatus;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
};

export type AcceptedStoreInvitation = {
  storeId: string;
  accountId: string;
  storeName: string;
  storeSlug: string;
  role: StoreRole;
};

function toInvitationView(row: typeof storeInvitations.$inferSelect): StoreInvitationView {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt,
    createdAt: row.createdAt,
  };
}

function invalidInvitation(): AppError {
  return new AppError({
    statusCode: 400,
    code: "INVITATION_INVALID",
    message: "The invitation is invalid or is no longer available.",
  });
}

function expiredInvitation(): AppError {
  return new AppError({
    statusCode: 400,
    code: "INVITATION_EXPIRED",
    message: "The invitation has expired.",
  });
}

export async function listStoreInvitations(access: StoreAccess): Promise<StoreInvitationView[]> {
  await assertTeamManagement(access);

  const rows = await db
    .select()
    .from(storeInvitations)
    .where(eq(storeInvitations.storeId, access.store.id))
    .orderBy(desc(storeInvitations.createdAt));

  return rows.map(toInvitationView);
}

export async function createStoreInvitation(
  access: StoreAccess,
  inviter: AuthUser,
  input: CreateStoreInvitationInput,
): Promise<StoreInvitationView> {
  await assertTeamManagement(access);

  if (access.role === "ADMIN" && input.role === "ADMIN") {
    throw new AppError({
      statusCode: 403,
      code: "ADMIN_CANNOT_INVITE_ADMINS",
      message: "Only the owner can invite administrators.",
    });
  }

  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(sql`lower(${users.email})`, input.email), sql`${users.deletedAt} is null`))
    .limit(1);

  if (existingUser) {
    const [membership] = await db
      .select({ id: storeMemberships.id, status: storeMemberships.status })
      .from(storeMemberships)
      .where(
        and(
          eq(storeMemberships.storeId, access.store.id),
          eq(storeMemberships.userId, existingUser.id),
        ),
      )
      .limit(1);

    if (membership && membership.status !== "removed") {
      throw new AppError({
        statusCode: 409,
        code: "ALREADY_STORE_MEMBER",
        message: "This user is already a member of the store.",
      });
    }
  }

  const [pending] = await db
    .select({ id: storeInvitations.id })
    .from(storeInvitations)
    .where(
      and(
        eq(storeInvitations.storeId, access.store.id),
        eq(sql`lower(${storeInvitations.email})`, input.email),
        eq(storeInvitations.status, "pending"),
      ),
    )
    .limit(1);

  if (pending) {
    throw new AppError({
      statusCode: 409,
      code: "INVITATION_ALREADY_PENDING",
      message: "There is already a pending invitation for this email.",
    });
  }

  const token = generateOpaqueToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + env.STORE_INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);

  let invitation: typeof storeInvitations.$inferSelect;

  try {
    invitation = await db.transaction(async (tx) => {
      // Serialize capacity changes for this store. This prevents two
      // concurrent invitations from both observing the last free slot.
      await tx
        .select({ id: stores.id })
        .from(stores)
        .where(eq(stores.id, access.store.id))
        .for("update")
        .limit(1);

      await assertTeamFeatureEnabled(access.account.id, tx);

      const [activeMembers] = await tx
        .select({ value: count() })
        .from(storeMemberships)
        .where(
          and(eq(storeMemberships.storeId, access.store.id), eq(storeMemberships.status, "active")),
        );
      const [pendingInvitations] = await tx
        .select({ value: count() })
        .from(storeInvitations)
        .where(
          and(
            eq(storeInvitations.storeId, access.store.id),
            eq(storeInvitations.status, "pending"),
          ),
        );

      await assertTeamMemberCapacity(
        access.account.id,
        Number(activeMembers?.value ?? 0) + Number(pendingInvitations?.value ?? 0),
        tx,
      );

      const [created] = await tx
        .insert(storeInvitations)
        .values({
          storeId: access.store.id,
          email: input.email,
          role: input.role,
          tokenHash,
          expiresAt,
          invitedByUserId: inviter.id,
        })
        .returning();

      if (!created) {
        throw new Error("Invitation insert did not return a row.");
      }

      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError({
        statusCode: 409,
        code: "INVITATION_ALREADY_PENDING",
        message: "There is already a pending invitation for this email.",
      });
    }

    throw error;
  }

  try {
    await sendStoreInvitationEmail({
      to: input.email,
      storeName: access.store.name,
      inviterName: inviter.displayName ?? inviter.email,
      token,
    });
  } catch (error) {
    // The invitation remains valid and can be resent by revoking and creating
    // a new one. Delivery failures must be visible to operators.
    logger.error(
      { err: error, storeId: access.store.id, invitationId: invitation.id },
      "Failed to send store invitation email",
    );
  }

  await recordAuditEvent({
    action: "store.invitation_created",
    actorUserId: inviter.id,
    accountId: access.account.id,
    storeId: access.store.id,
    entityType: "store_invitation",
    entityId: invitation.id,
    after: {
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
    },
  });

  return toInvitationView(invitation);
}

export async function revokeStoreInvitation(
  access: StoreAccess,
  invitationId: string,
): Promise<void> {
  await assertTeamManagement(access);

  const [revoked] = await db
    .update(storeInvitations)
    .set({ status: "revoked", updatedAt: new Date() })
    .where(
      and(
        eq(storeInvitations.id, invitationId),
        eq(storeInvitations.storeId, access.store.id),
        eq(storeInvitations.status, "pending"),
      ),
    )
    .returning({
      id: storeInvitations.id,
      email: storeInvitations.email,
      role: storeInvitations.role,
    });

  if (!revoked) {
    throw new AppError({
      statusCode: 404,
      code: "INVITATION_NOT_FOUND",
      message: "The pending invitation was not found.",
    });
  }

  await recordAuditEvent({
    action: "store.invitation_revoked",
    actorUserId: access.userId,
    accountId: access.account.id,
    storeId: access.store.id,
    entityType: "store_invitation",
    entityId: revoked.id,
    before: { email: revoked.email, role: revoked.role, status: "pending" },
    after: { status: "revoked" },
  });
}

type AcceptOutcome =
  | { kind: "accepted"; invitationId: string; result: AcceptedStoreInvitation }
  | { kind: "invalid" }
  | { kind: "expired" }
  | { kind: "email_mismatch" };

export async function acceptStoreInvitation(
  user: AuthUser,
  token: string,
): Promise<AcceptedStoreInvitation> {
  const tokenHash = hashToken(token);
  const now = new Date();

  const outcome = await db.transaction<AcceptOutcome>(async (tx) => {
    const [invitation] = await tx
      .select()
      .from(storeInvitations)
      .where(eq(storeInvitations.tokenHash, tokenHash))
      .for("update")
      .limit(1);

    if (invitation?.status !== "pending") {
      return { kind: "invalid" };
    }

    if (invitation.expiresAt.getTime() <= now.getTime()) {
      await tx
        .update(storeInvitations)
        .set({ status: "expired", updatedAt: now })
        .where(eq(storeInvitations.id, invitation.id));

      return { kind: "expired" };
    }

    if (invitation.email !== user.email.trim().toLowerCase()) {
      return { kind: "email_mismatch" };
    }

    const [store] = await tx
      .select({
        id: stores.id,
        accountId: stores.accountId,
        name: stores.name,
        slug: stores.slug,
        status: stores.status,
        deletedAt: stores.deletedAt,
        accountStatus: accounts.status,
      })
      .from(stores)
      .innerJoin(accounts, eq(accounts.id, stores.accountId))
      .where(eq(stores.id, invitation.storeId))
      .limit(1);

    if (
      !store ||
      store.deletedAt ||
      store.status !== "active" ||
      store.accountStatus !== "active"
    ) {
      return { kind: "invalid" };
    }

    await tx
      .select({ id: stores.id })
      .from(stores)
      .where(eq(stores.id, store.id))
      .for("update")
      .limit(1);

    const [membership] = await tx
      .select()
      .from(storeMemberships)
      .where(and(eq(storeMemberships.storeId, store.id), eq(storeMemberships.userId, user.id)))
      .for("update")
      .limit(1);

    if (membership?.status !== "active") {
      await assertTeamFeatureEnabled(store.accountId, tx);
      const [activeMembers] = await tx
        .select({ value: count() })
        .from(storeMemberships)
        .where(and(eq(storeMemberships.storeId, store.id), eq(storeMemberships.status, "active")));

      await assertTeamMemberCapacity(store.accountId, Number(activeMembers?.value ?? 0), tx);
    }

    let acceptedRole: StoreRole = invitation.role;

    if (membership?.status === "active") {
      acceptedRole = membership.role;
    } else if (membership) {
      await tx
        .update(storeMemberships)
        .set({
          role: invitation.role,
          status: "active",
          invitedByUserId: invitation.invitedByUserId,
          acceptedAt: now,
          updatedAt: now,
        })
        .where(eq(storeMemberships.id, membership.id));
    } else {
      await tx.insert(storeMemberships).values({
        storeId: store.id,
        userId: user.id,
        role: invitation.role,
        status: "active",
        invitedByUserId: invitation.invitedByUserId,
        acceptedAt: now,
      });
    }

    await tx
      .update(storeInvitations)
      .set({
        status: "accepted",
        acceptedByUserId: user.id,
        acceptedAt: now,
        updatedAt: now,
      })
      .where(eq(storeInvitations.id, invitation.id));

    return {
      kind: "accepted",
      invitationId: invitation.id,
      result: {
        storeId: store.id,
        accountId: store.accountId,
        storeName: store.name,
        storeSlug: store.slug,
        role: acceptedRole,
      },
    };
  });

  if (outcome.kind === "expired") {
    throw expiredInvitation();
  }

  if (outcome.kind === "email_mismatch") {
    throw new AppError({
      statusCode: 403,
      code: "INVITATION_EMAIL_MISMATCH",
      message: "The invitation was issued to a different email address.",
    });
  }

  if (outcome.kind === "invalid") {
    throw invalidInvitation();
  }

  await recordAuditEvent({
    action: "store.invitation_accepted",
    actorUserId: user.id,
    accountId: outcome.result.accountId,
    storeId: outcome.result.storeId,
    entityType: "store_invitation",
    entityId: outcome.invitationId,
    after: { role: outcome.result.role, status: "accepted" },
  });

  return outcome.result;
}
