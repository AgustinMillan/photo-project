import type { FastifyRequest } from "fastify";
import { env } from "../../config/env.js";
import { AppError } from "../errors/app-error.js";

const allowedOrigins = env.CORS_ORIGIN.split(",").map((origin) => origin.trim());

export function assertTrustedOrigin(request: FastifyRequest): void {
  const origin = request.headers.origin;

  if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
    return;
  }

  throw new AppError({
    statusCode: 403,
    code: "INVALID_ORIGIN",
    message: "The request origin is not allowed.",
  });
}
