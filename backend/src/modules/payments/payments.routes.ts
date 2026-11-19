import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { env } from "../../config/env.js";
import { assertTrustedOrigin } from "../../shared/http/origin.js";
import { routeRateLimit } from "../../shared/http/rate-limit.js";
import { logger } from "../../shared/logger.js";
import { authenticate } from "../auth/auth.guard.js";
import { requireActiveUser } from "../auth/auth.service.js";
import { orderParamsSchema, tokenQuerySchema } from "../orders/orders.schemas.js";
import { getCustomerOrder, requireCustomerOrder } from "../orders/orders.service.js";
import { requireStoreAccess } from "../stores/store-access.js";
import { storeParamsSchema } from "../stores/stores.schemas.js";
import {
  completeMercadoPagoConnect,
  createMercadoPagoCheckout,
  disconnectMercadoPago,
  getMercadoPagoConnection,
  handleMercadoPagoWebhook,
  startMercadoPagoConnect,
  syncMercadoPagoOrder,
} from "./mercadopago.service.js";

const callbackQuerySchema = z.object({
  code: z.string().max(500).optional(),
  state: z.string().max(1000).optional(),
  error: z.string().max(200).optional(),
});

async function ownerOrAdmin(request: FastifyRequest, storeId: string, ownerOnly = false) {
  const user = await requireActiveUser(request.user.sub);
  return requireStoreAccess(user.id, storeId, ownerOnly ? ["OWNER"] : ["OWNER", "ADMIN"]);
}

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

export const paymentsRoutes: FastifyPluginAsync = async (app) => {
  // --- Photographer: connect their own Mercado Pago -----------------------
  app.get(
    "/stores/:storeId/payments/mercadopago",
    { preHandler: authenticate },
    async (request) => {
      const { storeId } = storeParamsSchema.parse(request.params);
      return getMercadoPagoConnection(await ownerOrAdmin(request, storeId));
    },
  );

  app.post(
    "/stores/:storeId/payments/mercadopago/connect",
    { preHandler: authenticate },
    async (request) => {
      assertTrustedOrigin(request);
      const { storeId } = storeParamsSchema.parse(request.params);
      return startMercadoPagoConnect(await ownerOrAdmin(request, storeId, true));
    },
  );

  app.delete(
    "/stores/:storeId/payments/mercadopago",
    { preHandler: authenticate },
    async (request, reply) => {
      assertTrustedOrigin(request);
      const { storeId } = storeParamsSchema.parse(request.params);
      await disconnectMercadoPago(await ownerOrAdmin(request, storeId, true));
      return reply.status(204).send();
    },
  );

  // Browser redirect from Mercado Pago after the photographer authorizes.
  app.get(
    "/payments/mercadopago/callback",
    { config: { rateLimit: routeRateLimit(30, "1 minute") } },
    async (request, reply) => {
      const query = callbackQuerySchema.parse(request.query);
      const target = new URL("/app/payments", env.APP_URL);
      if (query.error || !query.code || !query.state) {
        target.searchParams.set("mp", "cancelled");
        return reply.redirect(target.toString());
      }
      try {
        await completeMercadoPagoConnect(query.code, query.state);
        target.searchParams.set("mp", "connected");
      } catch (error) {
        logger.warn({ err: error }, "Mercado Pago connection failed");
        target.searchParams.set("mp", "error");
      }
      return reply.redirect(target.toString());
    },
  );

  // Server-to-server notification from Mercado Pago.
  app.post(
    "/payments/mercadopago/webhook",
    { config: { rateLimit: routeRateLimit(600, "1 minute") } },
    async (request, reply) => {
      const query = request.query as Record<string, string | undefined>;
      const body = (request.body ?? {}) as { type?: string; data?: { id?: string | number } };
      const outcome = await handleMercadoPagoWebhook({
        storeId: query.store,
        dataId:
          query["data.id"] ?? (body.data?.id !== undefined ? String(body.data.id) : undefined),
        type: query.type ?? body.type,
        topic: query.topic,
        signature: header(request, "x-signature"),
        requestId: header(request, "x-request-id"),
      });
      return reply.status(outcome.status).send({ result: outcome.result });
    },
  );

  // --- Customer: pay a pending order with Mercado Pago --------------------
  app.post(
    "/public/orders/:orderId/mercadopago/checkout",
    { config: { rateLimit: routeRateLimit(30, "1 hour") } },
    async (request) => {
      const { orderId } = orderParamsSchema.parse(request.params);
      const { token } = tokenQuerySchema.parse(request.query);
      const { order } = await requireCustomerOrder(request.hostname, orderId, token);
      return createMercadoPagoCheckout(order.storeId, order.id);
    },
  );

  app.post(
    "/public/orders/:orderId/mercadopago/sync",
    { config: { rateLimit: routeRateLimit(60, "1 minute") } },
    async (request) => {
      const { orderId } = orderParamsSchema.parse(request.params);
      const { token } = tokenQuerySchema.parse(request.query);
      const { order } = await requireCustomerOrder(request.hostname, orderId, token);
      if (order.checkoutMethod === "mercadopago" && order.status !== "paid") {
        try {
          await syncMercadoPagoOrder(order.storeId, order.id);
        } catch (error) {
          logger.warn({ err: error, orderId }, "Mercado Pago sync failed");
        }
      }
      return getCustomerOrder(request.hostname, orderId, token);
    },
  );
};
