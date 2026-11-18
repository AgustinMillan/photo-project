import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../../config/env.js";

export const REFRESH_COOKIE_PATH = "/api/v1/auth";

export function refreshCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: REFRESH_COOKIE_PATH,
    maxAge: maxAgeSeconds,
  };
}

export function setRefreshCookie(reply: FastifyReply, refreshToken: string): void {
  reply.setCookie(
    env.REFRESH_COOKIE_NAME,
    refreshToken,
    refreshCookieOptions(env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60),
  );
}

export function clearRefreshCookie(reply: FastifyReply): void {
  reply.clearCookie(env.REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
}

export function readRefreshToken(request: FastifyRequest): string | undefined {
  return request.cookies[env.REFRESH_COOKIE_NAME];
}
