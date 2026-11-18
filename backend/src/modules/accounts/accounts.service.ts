import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db/client.js";
import { type AccountStatus, type AccountType, accounts } from "../../db/schema/index.js";
import { isUniqueViolation } from "../../shared/db/errors.js";
import { AppError } from "../../shared/errors/app-error.js";
import { recordAuditEvent } from "../audit/audit.service.js";
import type { AuthUser } from "../auth/auth.service.js";
import type { CreateAccountInput, UpdateAccountInput } from "./accounts.schemas.js";

type Account = typeof accounts.$inferSelect;

export type AccountView = {
  id: string;
  ownerUserId: string;
  type: AccountType;
  name: string;
  billingEmail: string;
  status: AccountStatus;
  createdAt: Date;
  updatedAt: Date;
};

function toAccountView(account: Account): AccountView {
  return {
    id: account.id,
    ownerUserId: account.ownerUserId,
    type: account.type,
    name: account.name,
    billingEmail: account.billingEmail,
    status: account.status,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

export async function getAccountForUser(userId: string): Promise<AccountView | null> {
  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.ownerUserId, userId), isNull(accounts.deletedAt)))
    .limit(1);

  return account ? toAccountView(account) : null;
}

export async function createAccount(
  user: AuthUser,
  input: CreateAccountInput,
): Promise<AccountView> {
  const existing = await getAccountForUser(user.id);

  if (existing) {
    throw new AppError({
      statusCode: 409,
      code: "ACCOUNT_ALREADY_EXISTS",
      message: "This user already owns an account.",
    });
  }

  let account: Account;

  try {
    const [created] = await db
      .insert(accounts)
      .values({
        ownerUserId: user.id,
        type: input.type ?? "individual",
        name: input.name,
        billingEmail: input.billingEmail ?? user.email,
      })
      .returning();

    if (!created) {
      throw new Error("Account insert did not return a row.");
    }

    account = created;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError({
        statusCode: 409,
        code: "ACCOUNT_ALREADY_EXISTS",
        message: "This user already owns an account.",
      });
    }

    throw error;
  }

  const view = toAccountView(account);

  await recordAuditEvent({
    action: "account.created",
    actorUserId: user.id,
    accountId: account.id,
    entityType: "account",
    entityId: account.id,
    after: { name: view.name, type: view.type, status: view.status },
  });

  return view;
}

export async function updateAccount(
  userId: string,
  input: UpdateAccountInput,
): Promise<AccountView> {
  const current = await getAccountForUser(userId);

  if (!current) {
    throw new AppError({
      statusCode: 404,
      code: "ACCOUNT_NOT_FOUND",
      message: "The account was not found.",
    });
  }

  const [updated] = await db
    .update(accounts)
    .set({
      name: input.name ?? current.name,
      billingEmail: input.billingEmail ?? current.billingEmail,
      type: input.type ?? current.type,
      updatedAt: new Date(),
    })
    .where(eq(accounts.id, current.id))
    .returning();

  if (!updated) {
    throw new AppError({
      statusCode: 404,
      code: "ACCOUNT_NOT_FOUND",
      message: "The account was not found.",
    });
  }

  const view = toAccountView(updated);

  await recordAuditEvent({
    action: "account.updated",
    actorUserId: userId,
    accountId: current.id,
    entityType: "account",
    entityId: current.id,
    before: { name: current.name, billingEmail: current.billingEmail, type: current.type },
    after: { name: view.name, billingEmail: view.billingEmail, type: view.type },
  });

  return view;
}
