import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { AppError } from "../../shared/errors/app-error.js";
import { getAccountForUser } from "../accounts/accounts.service.js";
import { authenticate } from "../auth/auth.guard.js";
import { requireActiveUser } from "../auth/auth.service.js";
import { requireStoreAccess } from "../stores/store-access.js";
import { storeParamsSchema } from "../stores/stores.schemas.js";
import {
  cancelAutomaticPayment,
  listSellablePlans,
  listSubscriptionPayments,
  startSubscriptionCheckout,
  syncAccountSubscription,
} from "./billing.mercadopago.js";
import {
  getAccountSubscription,
  getEffectiveEntitlements,
  getStoreSalesStatus,
} from "./billing.service.js";

async function activeUser(request: FastifyRequest) {
  return requireActiveUser(request.user.sub);
}

async function requireOwnAccount(request: FastifyRequest) {
  const user = await activeUser(request);
  const account = await getAccountForUser(user.id);
  if (!account) {
    throw new AppError({
      statusCode: 404,
      code: "ACCOUNT_NOT_FOUND",
      message: "The account was not found.",
    });
  }
  return { user, account };
}

const checkoutSchema = z.object({
  planCode: z.string().trim().min(1).max(40),
  payerEmail: z.string().trim().toLowerCase().email().max(254).optional(),
});

export const billingRoutes: FastifyPluginAsync = async (app) => {
  app.get("/accounts/me/subscription", { preHandler: authenticate }, async (request) => {
    const user = await activeUser(request);
    const account = await getAccountForUser(user.id);

    if (!account) {
      throw new AppError({
        statusCode: 404,
        code: "ACCOUNT_NOT_FOUND",
        message: "The account was not found.",
      });
    }

    return { subscription: await getAccountSubscription(account.id) };
  });

  app.get("/accounts/me/entitlements", { preHandler: authenticate }, async (request) => {
    const user = await activeUser(request);
    const account = await getAccountForUser(user.id);

    if (!account) {
      throw new AppError({
        statusCode: 404,
        code: "ACCOUNT_NOT_FOUND",
        message: "The account was not found.",
      });
    }

    return { entitlements: await getEffectiveEntitlements(account.id) };
  });

  app.get("/stores/:storeId/features", { preHandler: authenticate }, async (request) => {
    const user = await activeUser(request);
    const { storeId } = storeParamsSchema.parse(request.params);
    const access = await requireStoreAccess(user.id, storeId);

    return { entitlements: await getEffectiveEntitlements(access.account.id) };
  });

  app.get("/stores/:storeId/sales-status", { preHandler: authenticate }, async (request) => {
    const user = await activeUser(request);
    const { storeId } = storeParamsSchema.parse(request.params);
    await requireStoreAccess(user.id, storeId);

    return { sales: await getStoreSalesStatus(storeId) };
  });

  app.get("/billing/plans", { preHandler: authenticate }, async () => {
    return { plans: await listSellablePlans() };
  });

  app.post("/accounts/me/subscription/checkout", { preHandler: authenticate }, async (request) => {
    const { user, account } = await requireOwnAccount(request);
    const input = checkoutSchema.parse(request.body ?? {});
    return startSubscriptionCheckout({
      accountId: account.id,
      actorUserId: user.id,
      planCode: input.planCode,
      payerEmail: input.payerEmail ?? user.email,
    });
  });

  app.post("/accounts/me/subscription/sync", { preHandler: authenticate }, async (request) => {
    const { account } = await requireOwnAccount(request);
    return { subscription: await syncAccountSubscription(account.id) };
  });

  app.post("/accounts/me/subscription/cancel", { preHandler: authenticate }, async (request) => {
    const { user, account } = await requireOwnAccount(request);
    return { subscription: await cancelAutomaticPayment(account.id, user.id) };
  });

  app.get("/accounts/me/subscription/payments", { preHandler: authenticate }, async (request) => {
    const { account } = await requireOwnAccount(request);
    return { payments: await listSubscriptionPayments(account.id) };
  });
};
