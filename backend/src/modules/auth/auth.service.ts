import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { env } from "../../config/env.js";
import { db } from "../../db/client.js";
import {
  emailVerificationTokens,
  passwordResetTokens,
  type UserStatus,
  userAttribution,
  userSessions,
  users,
} from "../../db/schema/index.js";
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from "../../shared/auth/password.js";
import { generateOpaqueToken, hashToken } from "../../shared/auth/tokens.js";
import { isUniqueViolation } from "../../shared/db/errors.js";
import { AppError } from "../../shared/errors/app-error.js";
import { logger } from "../../shared/logger.js";
import { platformHost, resolveAttribution } from "../analytics/attribution.js";
import { recordAuditEvent } from "../audit/audit.service.js";
import { sendPasswordResetEmail, sendVerificationEmail } from "./auth.email.js";
import type { LoginInput, RegisterInput } from "./auth.schemas.js";

type User = typeof users.$inferSelect;

export type AuthUser = {
  id: string;
  email: string;
  displayName: string | null;
  status: UserStatus;
  emailVerifiedAt: Date | null;
  createdAt: Date;
};

export type SessionMeta = {
  ip?: string;
  userAgent?: string;
  requestId?: string;
};

export type SessionCredentials = {
  id: string;
  refreshToken: string;
  expiresAt: Date;
};

export type AuthResult = {
  user: AuthUser;
  session: SessionCredentials;
};

export type RegisterResult = {
  user: AuthUser;
};

export type LogoutResult = {
  userId: string;
} | null;

type RefreshOutcome =
  | { kind: "not_found" }
  | { kind: "expired" }
  | { kind: "inactive" }
  | { kind: "reused"; userId: string }
  | { kind: "rotated"; user: AuthUser; session: SessionCredentials };

type VerifyEmailOutcome = { kind: "invalid" } | { kind: "verified"; userId: string };

type ResetPasswordOutcome = { kind: "invalid" } | { kind: "reset"; userId: string };

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

function addDays(date: Date, days: number): Date {
  return addSeconds(date, days * 24 * 60 * 60);
}

function addHours(date: Date, hours: number): Date {
  return addSeconds(date, hours * 60 * 60);
}

function addMinutes(date: Date, minutes: number): Date {
  return addSeconds(date, minutes * 60);
}

function truncateUserAgent(userAgent: string | undefined): string | null {
  return userAgent ? userAgent.slice(0, 512) : null;
}

function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    status: user.status,
    emailVerifiedAt: user.emailVerifiedAt,
    createdAt: user.createdAt,
  };
}

async function findUserByEmail(email: string): Promise<User | undefined> {
  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${normalizeEmail(email)}`)
    .limit(1);

  return user;
}

function buildSession(userId: string, familyId: string, meta: SessionMeta) {
  const id = randomUUID();
  const refreshToken = generateOpaqueToken();
  const expiresAt = addDays(new Date(), env.REFRESH_TOKEN_TTL_DAYS);

  return {
    credentials: { id, refreshToken, expiresAt } satisfies SessionCredentials,
    values: {
      id,
      userId,
      refreshTokenHash: hashToken(refreshToken),
      familyId,
      expiresAt,
      ip: meta.ip ?? null,
      userAgent: truncateUserAgent(meta.userAgent),
    },
  };
}

async function createSession(
  userId: string,
  familyId: string,
  meta: SessionMeta,
): Promise<SessionCredentials> {
  const session = buildSession(userId, familyId, meta);
  await db.insert(userSessions).values(session.values);
  return session.credentials;
}

export async function registerUser(input: RegisterInput): Promise<RegisterResult> {
  const email = normalizeEmail(input.email);
  const existing = await findUserByEmail(email);

  if (existing) {
    throw new AppError({
      statusCode: 409,
      code: "EMAIL_ALREADY_REGISTERED",
      message: "An account with this email already exists.",
    });
  }

  const passwordHash = await hashPassword(input.password);
  const verificationToken = generateOpaqueToken();
  const verificationTokenHash = hashToken(verificationToken);
  const verificationExpiresAt = addHours(new Date(), env.EMAIL_VERIFICATION_TTL_HOURS);

  let created: User;

  try {
    created = await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          email,
          passwordHash,
          displayName: input.displayName ?? null,
        })
        .returning();

      if (!user) {
        throw new Error("User insert did not return a row.");
      }

      await tx.insert(emailVerificationTokens).values({
        userId: user.id,
        email,
        tokenHash: verificationTokenHash,
        expiresAt: verificationExpiresAt,
      });

      const origin = resolveAttribution(input.attribution ?? {}, [platformHost()]);
      await tx.insert(userAttribution).values({
        userId: user.id,
        ...origin,
        landingPath: (input.attribution?.path ?? "").slice(0, 200),
      });

      return user;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError({
        statusCode: 409,
        code: "EMAIL_ALREADY_REGISTERED",
        message: "An account with this email already exists.",
      });
    }

    throw error;
  }

  try {
    await sendVerificationEmail(email, verificationToken);
  } catch (error) {
    logger.error({ err: error, userId: created.id }, "Failed to send email verification message");
  }

  return { user: toAuthUser(created) };
}

export async function resendVerificationEmail(emailInput: string): Promise<void> {
  const email = normalizeEmail(emailInput);
  const user = await findUserByEmail(email);

  if (user?.status !== "pending_verification") {
    return;
  }

  if (user.deletedAt) {
    return;
  }

  const token = generateOpaqueToken();
  const tokenHash = hashToken(token);
  const expiresAt = addHours(new Date(), env.EMAIL_VERIFICATION_TTL_HOURS);
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(emailVerificationTokens)
      .set({ usedAt: now })
      .where(
        and(eq(emailVerificationTokens.userId, user.id), isNull(emailVerificationTokens.usedAt)),
      );

    await tx.insert(emailVerificationTokens).values({
      userId: user.id,
      email,
      tokenHash,
      expiresAt,
    });
  });

  try {
    await sendVerificationEmail(email, token);
  } catch (error) {
    logger.error({ err: error, userId: user.id }, "Failed to resend verification email");
  }
}

export async function verifyEmail(token: string): Promise<{ userId: string }> {
  const tokenHash = hashToken(token);

  const outcome = await db.transaction(async (tx): Promise<VerifyEmailOutcome> => {
    const [record] = await tx
      .select()
      .from(emailVerificationTokens)
      .where(eq(emailVerificationTokens.tokenHash, tokenHash))
      .limit(1)
      .for("update");

    if (!record || record.usedAt || record.expiresAt <= new Date()) {
      return { kind: "invalid" };
    }

    const [user] = await tx
      .select()
      .from(users)
      .where(eq(users.id, record.userId))
      .limit(1)
      .for("update");

    if (!user || user.deletedAt || user.status === "disabled") {
      return { kind: "invalid" };
    }

    const now = new Date();
    await tx
      .update(emailVerificationTokens)
      .set({ usedAt: now })
      .where(
        and(eq(emailVerificationTokens.userId, user.id), isNull(emailVerificationTokens.usedAt)),
      );

    if (user.status === "pending_verification") {
      await tx
        .update(users)
        .set({
          status: "active",
          emailVerifiedAt: user.emailVerifiedAt ?? now,
          updatedAt: now,
        })
        .where(eq(users.id, user.id));
    }

    return { kind: "verified", userId: user.id };
  });

  if (outcome.kind !== "verified") {
    throw new AppError({
      statusCode: 400,
      code: "INVALID_OR_EXPIRED_TOKEN",
      message: "The verification token is invalid, expired or already used.",
    });
  }

  return { userId: outcome.userId };
}

export async function loginUser(input: LoginInput, meta: SessionMeta): Promise<AuthResult> {
  const user = await findUserByEmail(input.email);
  const passwordHash = user?.passwordHash ?? DUMMY_PASSWORD_HASH;

  let passwordValid = false;

  try {
    passwordValid = await verifyPassword(passwordHash, input.password);
  } catch {
    passwordValid = false;
  }

  if (!user || !passwordValid) {
    throw new AppError({
      statusCode: 401,
      code: "INVALID_CREDENTIALS",
      message: "Email or password is incorrect.",
    });
  }

  if (user.deletedAt) {
    throw new AppError({
      statusCode: 401,
      code: "INVALID_CREDENTIALS",
      message: "Email or password is incorrect.",
    });
  }

  if (user.status === "pending_verification") {
    throw new AppError({
      statusCode: 403,
      code: "EMAIL_NOT_VERIFIED",
      message: "Verify your email before signing in.",
    });
  }

  if (user.status !== "active") {
    throw new AppError({
      statusCode: 403,
      code: "ACCOUNT_DISABLED",
      message: "This account is not available.",
    });
  }

  const session = await createSession(user.id, randomUUID(), meta);
  const now = new Date();

  await db.update(users).set({ lastLoginAt: now, updatedAt: now }).where(eq(users.id, user.id));

  return { user: toAuthUser(user), session };
}

export async function refreshSession(refreshToken: string, meta: SessionMeta): Promise<AuthResult> {
  const tokenHash = hashToken(refreshToken);

  const outcome = await db.transaction(async (tx): Promise<RefreshOutcome> => {
    const [session] = await tx
      .select()
      .from(userSessions)
      .where(eq(userSessions.refreshTokenHash, tokenHash))
      .limit(1)
      .for("update");

    if (!session) {
      return { kind: "not_found" };
    }

    if (session.revokedAt) {
      const now = new Date();

      await tx
        .update(userSessions)
        .set({ revokedAt: now, revokedReason: "reuse_detected" })
        .where(and(eq(userSessions.familyId, session.familyId), isNull(userSessions.revokedAt)));

      return { kind: "reused", userId: session.userId };
    }

    if (session.expiresAt <= new Date()) {
      return { kind: "expired" };
    }

    const [user] = await tx
      .select()
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1)
      .for("update");

    if (!user || user.deletedAt || user.status !== "active") {
      await tx
        .update(userSessions)
        .set({ revokedAt: new Date(), revokedReason: "user_inactive" })
        .where(eq(userSessions.id, session.id));

      return { kind: "inactive" };
    }

    const now = new Date();
    await tx
      .update(userSessions)
      .set({ revokedAt: now, revokedReason: "rotation", lastUsedAt: now })
      .where(eq(userSessions.id, session.id));

    const next = buildSession(user.id, session.familyId, meta);
    await tx.insert(userSessions).values(next.values);

    return { kind: "rotated", user: toAuthUser(user), session: next.credentials };
  });

  if (outcome.kind === "reused") {
    await recordAuditEvent({
      action: "auth.refresh_reuse_detected",
      actorUserId: outcome.userId,
      entityType: "user",
      entityId: outcome.userId,
      ip: meta.ip,
      userAgent: meta.userAgent,
      requestId: meta.requestId,
    });

    throw new AppError({
      statusCode: 401,
      code: "REFRESH_TOKEN_REUSED",
      message: "The refresh token was already used. Sign in again.",
    });
  }

  if (outcome.kind === "not_found") {
    throw new AppError({
      statusCode: 401,
      code: "INVALID_REFRESH_TOKEN",
      message: "The refresh token is invalid.",
    });
  }

  if (outcome.kind === "expired") {
    throw new AppError({
      statusCode: 401,
      code: "REFRESH_TOKEN_EXPIRED",
      message: "The refresh token has expired. Sign in again.",
    });
  }

  if (outcome.kind === "inactive") {
    throw new AppError({
      statusCode: 401,
      code: "INVALID_REFRESH_TOKEN",
      message: "The refresh token is invalid.",
    });
  }

  return { user: outcome.user, session: outcome.session };
}

export async function logoutSession(
  refreshToken: string,
  allDevices: boolean,
): Promise<LogoutResult> {
  const tokenHash = hashToken(refreshToken);
  const [session] = await db
    .select()
    .from(userSessions)
    .where(eq(userSessions.refreshTokenHash, tokenHash))
    .limit(1);

  if (!session) {
    return null;
  }

  const now = new Date();

  if (allDevices) {
    await db
      .update(userSessions)
      .set({ revokedAt: now, revokedReason: "logout_all" })
      .where(and(eq(userSessions.userId, session.userId), isNull(userSessions.revokedAt)));
  } else {
    await db
      .update(userSessions)
      .set({ revokedAt: now, revokedReason: "logout" })
      .where(and(eq(userSessions.id, session.id), isNull(userSessions.revokedAt)));
  }

  return { userId: session.userId };
}

export async function requestPasswordReset(emailInput: string): Promise<void> {
  const email = normalizeEmail(emailInput);
  const user = await findUserByEmail(email);

  if (user?.status !== "active") {
    return;
  }

  if (user.deletedAt) {
    return;
  }

  const token = generateOpaqueToken();
  const tokenHash = hashToken(token);
  const expiresAt = addMinutes(new Date(), env.PASSWORD_RESET_TTL_MINUTES);
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(passwordResetTokens)
      .set({ usedAt: now })
      .where(and(eq(passwordResetTokens.userId, user.id), isNull(passwordResetTokens.usedAt)));

    await tx.insert(passwordResetTokens).values({
      userId: user.id,
      tokenHash,
      expiresAt,
    });
  });

  try {
    await sendPasswordResetEmail(email, token);
  } catch (error) {
    logger.error({ err: error, userId: user.id }, "Failed to send password reset email");
  }
}

export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<{ userId: string }> {
  const tokenHash = hashToken(token);
  const passwordHash = await hashPassword(newPassword);

  const outcome = await db.transaction(async (tx): Promise<ResetPasswordOutcome> => {
    const [record] = await tx
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.tokenHash, tokenHash))
      .limit(1)
      .for("update");

    if (!record || record.usedAt || record.expiresAt <= new Date()) {
      return { kind: "invalid" };
    }

    const [user] = await tx
      .select()
      .from(users)
      .where(eq(users.id, record.userId))
      .limit(1)
      .for("update");

    if (!user || user.deletedAt || user.status !== "active") {
      return { kind: "invalid" };
    }

    const now = new Date();

    await tx
      .update(passwordResetTokens)
      .set({ usedAt: now })
      .where(and(eq(passwordResetTokens.userId, user.id), isNull(passwordResetTokens.usedAt)));

    await tx.update(users).set({ passwordHash, updatedAt: now }).where(eq(users.id, user.id));

    await tx
      .update(userSessions)
      .set({ revokedAt: now, revokedReason: "password_reset" })
      .where(and(eq(userSessions.userId, user.id), isNull(userSessions.revokedAt)));

    return { kind: "reset", userId: user.id };
  });

  if (outcome.kind !== "reset") {
    throw new AppError({
      statusCode: 400,
      code: "INVALID_OR_EXPIRED_TOKEN",
      message: "The password reset token is invalid, expired or already used.",
    });
  }

  return { userId: outcome.userId };
}

export async function getUserById(userId: string): Promise<AuthUser | null> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

  if (!user || user.deletedAt || user.status !== "active") {
    return null;
  }

  return toAuthUser(user);
}

export async function requireActiveUser(userId: string): Promise<AuthUser> {
  const user = await getUserById(userId);

  if (!user) {
    throw new AppError({
      statusCode: 401,
      code: "UNAUTHENTICATED",
      message: "Authentication required.",
    });
  }

  return user;
}
