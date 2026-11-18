import { createReadStream } from "node:fs";
import { access as fileAccess } from "node:fs/promises";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { AppError } from "../../shared/errors/app-error.js";
import { assertTrustedOrigin } from "../../shared/http/origin.js";
import { routeRateLimit } from "../../shared/http/rate-limit.js";
import { authenticate } from "../auth/auth.guard.js";
import { requireActiveUser } from "../auth/auth.service.js";
import { requireStoreAccess } from "../stores/store-access.js";
import { normalizeHostname } from "../stores/stores.constants.js";
import { storeParamsSchema } from "../stores/stores.schemas.js";
import {
  createOrderSchema,
  downloadParamsSchema,
  listOrdersQuerySchema,
  orderParamsSchema,
  recordPaymentSchema,
  storeOrderParamsSchema,
  tokenQuerySchema,
} from "./orders.schemas.js";
import {
  authorizeDownload,
  cancelOrder,
  createOrder,
  getCustomerOrder,
  getStoreOrder,
  listStoreOrders,
  orderCustomerLink,
  recordPayment,
} from "./orders.service.js";

const SALES_ROLES = ["OWNER", "ADMIN"] as const;

/** Public writes must come from the storefront itself (same host). */
function assertSameOriginStorefront(request: FastifyRequest): void {
  const origin = request.headers.origin;
  if (!origin) return;
  let host = "";
  try {
    host = new URL(origin).hostname;
  } catch {
    host = "";
  }
  if (host !== normalizeHostname(request.hostname)) {
    throw new AppError({
      statusCode: 403,
      code: "INVALID_ORIGIN",
      message: "The request origin is not allowed.",
    });
  }
}

async function salesAccess(request: FastifyRequest, storeId: string) {
  const user = await requireActiveUser(request.user.sub);
  return requireStoreAccess(user.id, storeId, SALES_ROLES);
}

export const ordersRoutes: FastifyPluginAsync = async (app) => {
  // --- Customer (public, link-authorized) ---------------------------------
  app.post(
    "/public/orders",
    { config: { rateLimit: routeRateLimit(20, "1 hour") } },
    async (request, reply) => {
      assertSameOriginStorefront(request);
      const order = await createOrder(request.hostname, createOrderSchema.parse(request.body));
      return reply.status(201).send({ order });
    },
  );

  app.get(
    "/public/orders/:orderId",
    { config: { rateLimit: routeRateLimit(120, "1 minute") } },
    async (request) => {
      const { orderId } = orderParamsSchema.parse(request.params);
      const { token } = tokenQuerySchema.parse(request.query);
      return getCustomerOrder(request.hostname, orderId, token);
    },
  );

  app.get(
    "/public/orders/:orderId/photos/:photoId/download",
    { config: { rateLimit: routeRateLimit(300, "1 hour") } },
    async (request, reply) => {
      const { orderId, photoId } = downloadParamsSchema.parse(request.params);
      const { token } = tokenQuerySchema.parse(request.query);
      const file = await authorizeDownload(request.hostname, orderId, photoId, token, {
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      });
      await fileAccess(file.path).catch(() => {
        throw new AppError({
          statusCode: 410,
          code: "FILE_MISSING",
          message: "The file is not available.",
        });
      });
      const safeName = file.filename.replace(/[^\w.\- ]+/g, "_") || "foto";
      return reply
        .header("content-type", file.mimeType)
        .header("content-length", file.bytes)
        .header("cache-control", "private, no-store")
        .header("content-disposition", `attachment; filename="${safeName}"`)
        .send(createReadStream(file.path));
    },
  );

  // --- Photographer -------------------------------------------------------
  app.get("/stores/:storeId/orders", { preHandler: authenticate }, async (request) => {
    const { storeId } = storeParamsSchema.parse(request.params);
    const { status } = listOrdersQuerySchema.parse(request.query);
    return { orders: await listStoreOrders(await salesAccess(request, storeId), status) };
  });

  app.get("/stores/:storeId/orders/:orderId", { preHandler: authenticate }, async (request) => {
    const { storeId, orderId } = storeOrderParamsSchema.parse(request.params);
    return getStoreOrder(await salesAccess(request, storeId), orderId);
  });

  app.post(
    "/stores/:storeId/orders/:orderId/payments",
    { preHandler: authenticate },
    async (request) => {
      assertTrustedOrigin(request);
      const { storeId, orderId } = storeOrderParamsSchema.parse(request.params);
      const access = await salesAccess(request, storeId);
      return recordPayment(access, orderId, recordPaymentSchema.parse(request.body));
    },
  );

  app.post(
    "/stores/:storeId/orders/:orderId/cancel",
    { preHandler: authenticate },
    async (request) => {
      assertTrustedOrigin(request);
      const { storeId, orderId } = storeOrderParamsSchema.parse(request.params);
      return cancelOrder(await salesAccess(request, storeId), orderId);
    },
  );

  app.get(
    "/stores/:storeId/orders/:orderId/link",
    { preHandler: authenticate },
    async (request) => {
      const { storeId, orderId } = storeOrderParamsSchema.parse(request.params);
      return orderCustomerLink(await salesAccess(request, storeId), orderId);
    },
  );
};
