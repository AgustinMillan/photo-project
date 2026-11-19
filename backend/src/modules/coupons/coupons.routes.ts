import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { db } from "../../db/client.js";
import { routeRateLimit } from "../../shared/http/rate-limit.js";
import { authenticate } from "../auth/auth.guard.js";
import { requireActiveUser } from "../auth/auth.service.js";
import { requirePublishedStoreByHost } from "../storefront/storefront.service.js";
import { requireStoreAccess } from "../stores/store-access.js";
import { storeParamsSchema } from "../stores/stores.schemas.js";
import {
  checkCouponSchema,
  couponParamsSchema,
  createCouponSchema,
  updateCouponSchema,
} from "./coupons.schemas.js";
import {
  applyCoupon,
  createCoupon,
  deleteCoupon,
  listCoupons,
  priceCartLines,
  updateCoupon,
} from "./coupons.service.js";

async function couponAccess(request: FastifyRequest, storeId: string) {
  const user = await requireActiveUser(request.user.sub);
  return requireStoreAccess(user.id, storeId, ["OWNER", "ADMIN"]);
}

export const couponsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/stores/:storeId/coupons", { preHandler: authenticate }, async (request) => {
    const { storeId } = storeParamsSchema.parse(request.params);
    return { coupons: await listCoupons(await couponAccess(request, storeId)) };
  });

  app.post("/stores/:storeId/coupons", { preHandler: authenticate }, async (request, reply) => {
    const { storeId } = storeParamsSchema.parse(request.params);
    const access = await couponAccess(request, storeId);
    const coupon = await createCoupon(access, createCouponSchema.parse(request.body));
    return reply.status(201).send({ coupon });
  });

  app.patch("/stores/:storeId/coupons/:couponId", { preHandler: authenticate }, async (request) => {
    const { storeId, couponId } = couponParamsSchema.parse(request.params);
    const access = await couponAccess(request, storeId);
    return { coupon: await updateCoupon(access, couponId, updateCouponSchema.parse(request.body)) };
  });

  app.delete(
    "/stores/:storeId/coupons/:couponId",
    { preHandler: authenticate },
    async (request) => {
      const { storeId, couponId } = couponParamsSchema.parse(request.params);
      return deleteCoupon(await couponAccess(request, storeId), couponId);
    },
  );

  // Cart check: shows the discount before the customer places the order.
  app.post(
    "/public/coupons/check",
    { config: { rateLimit: routeRateLimit(30, "1 minute") } },
    async (request) => {
      const store = await requirePublishedStoreByHost(request.hostname);
      const input = checkCouponSchema.parse(request.body);
      const lines = await priceCartLines(store.id, input.items);
      const subtotalCents = lines.reduce((sum, line) => sum + line.priceCents, 0);
      const { coupon, discountCents } = await applyCoupon(db, store.id, input.code, lines);
      return {
        code: coupon.code,
        percentOff: coupon.percentOff,
        appliesTo: coupon.appliesTo,
        subtotalCents,
        discountCents,
        totalCents: subtotalCents - discountCents,
      };
    },
  );
};
