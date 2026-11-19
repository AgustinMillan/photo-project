import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { routeRateLimit } from "../../shared/http/rate-limit.js";
import { authenticate } from "../auth/auth.guard.js";
import { requireActiveUser } from "../auth/auth.service.js";
import { STATS_ENABLED_FEATURE } from "../billing/billing.constants.js";
import { assertFeatureEnabled } from "../billing/billing.service.js";
import { requireStoreAccess } from "../stores/store-access.js";
import { storeParamsSchema } from "../stores/stores.schemas.js";
import { getStoreStats, recordVisit } from "./analytics.service.js";
import { attributionInputSchema } from "./attribution.js";

const statsQuerySchema = z.object({
  days: z.coerce
    .number()
    .int()
    .refine((value) => [7, 30, 90].includes(value))
    .default(30),
});

export const analyticsRoutes: FastifyPluginAsync = async (app) => {
  // Cookie-free page view from the landing page or a storefront.
  app.post(
    "/public/visit",
    { config: { rateLimit: routeRateLimit(120, "1 minute") } },
    async (request, reply) => {
      const parsed = attributionInputSchema.safeParse(request.body ?? {});
      await recordVisit({
        hostname: request.hostname,
        ip: request.ip,
        userAgent: request.headers["user-agent"],
        attribution: parsed.success ? parsed.data : {},
      }).catch((error) => request.log.warn({ err: error }, "Visit not recorded"));
      return reply.status(204).send();
    },
  );

  app.get("/stores/:storeId/stats", { preHandler: authenticate }, async (request) => {
    const user = await requireActiveUser(request.user.sub);
    const { storeId } = storeParamsSchema.parse(request.params);
    const access = await requireStoreAccess(user.id, storeId);
    await assertFeatureEnabled(
      access.account.id,
      STATS_ENABLED_FEATURE,
      "STATS_NOT_IN_PLAN",
      "Statistics are available on the Profesional plan.",
    );
    const { days } = statsQuerySchema.parse(request.query);
    return { stats: await getStoreStats(storeId, days) };
  });
};
