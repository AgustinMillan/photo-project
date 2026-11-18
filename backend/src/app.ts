import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import { env } from "./config/env.js";
import { accountsRoutes } from "./modules/accounts/accounts.routes.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { billingRoutes } from "./modules/billing/billing.routes.js";
import { catalogRoutes } from "./modules/catalog/catalog.routes.js";
import { healthRoutes } from "./modules/health/health.routes.js";
import { ordersRoutes } from "./modules/orders/orders.routes.js";
import { paymentsRoutes } from "./modules/payments/payments.routes.js";
import { storefrontRoutes } from "./modules/storefront/storefront.routes.js";
import { storesRoutes } from "./modules/stores/stores.routes.js";
import { registerErrorHandler } from "./shared/http/error-handler.js";
import { logger } from "./shared/logger.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: logger as FastifyBaseLogger,
    trustProxy: true,
    requestIdHeader: "x-request-id",
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: env.CORS_ORIGIN.split(",").map((origin) => origin.trim()),
    credentials: true,
  });
  await app.register(cookie);
  await app.register(jwt, {
    secret: env.JWT_ACCESS_SECRET,
    sign: {
      iss: env.JWT_ISSUER,
      aud: env.JWT_AUDIENCE,
      expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    },
    verify: {
      allowedIss: env.JWT_ISSUER,
      allowedAud: env.JWT_AUDIENCE,
    },
  });
  await app.register(rateLimit, {
    max: env.NODE_ENV === "test" ? 10_000 : 100,
    timeWindow: "1 minute",
  });

  await app.register(multipart, {
    limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 5 },
  });

  registerErrorHandler(app);

  await app.register(healthRoutes, { prefix: "/api/v1/health" });
  await app.register(authRoutes, { prefix: "/api/v1/auth" });
  await app.register(accountsRoutes, { prefix: "/api/v1" });
  await app.register(billingRoutes, { prefix: "/api/v1" });
  await app.register(storesRoutes, { prefix: "/api/v1" });
  await app.register(storefrontRoutes, { prefix: "/api/v1" });
  await app.register(catalogRoutes, { prefix: "/api/v1" });
  await app.register(ordersRoutes, { prefix: "/api/v1" });
  await app.register(paymentsRoutes, { prefix: "/api/v1" });

  return app;
}
