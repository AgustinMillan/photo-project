import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import { env } from "../../config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import { assertTrustedOrigin } from "../../shared/http/origin.js";
import { routeRateLimit } from "../../shared/http/rate-limit.js";
import { recordAuditEvent } from "../audit/audit.service.js";
import { clearRefreshCookie, readRefreshToken, setRefreshCookie } from "./auth.cookies.js";
import { authenticate } from "./auth.guard.js";
import {
  forgotPasswordSchema,
  loginSchema,
  logoutSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from "./auth.schemas.js";
import {
  type AuthResult,
  getUserById,
  loginUser,
  logoutSession,
  refreshSession,
  registerUser,
  requestPasswordReset,
  resendVerificationEmail,
  resetPassword,
  type SessionMeta,
  verifyEmail,
} from "./auth.service.js";

function sessionMeta(request: FastifyRequest): SessionMeta {
  return {
    ip: request.ip,
    userAgent: request.headers["user-agent"],
    requestId: request.id,
  };
}

function buildAuthResponse(app: FastifyInstance, result: AuthResult) {
  return {
    accessToken: app.jwt.sign({
      sub: result.user.id,
      sid: result.session.id,
      type: "access",
    }),
    tokenType: "Bearer" as const,
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    user: result.user,
  };
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/register",
    { config: { rateLimit: routeRateLimit(5, "15 minutes") } },
    async (request, reply) => {
      assertTrustedOrigin(request);
      const input = registerSchema.parse(request.body);
      const result = await registerUser(input);

      await recordAuditEvent({
        action: "auth.register",
        actorUserId: result.user.id,
        entityType: "user",
        entityId: result.user.id,
        ip: request.ip,
        userAgent: request.headers["user-agent"],
        requestId: request.id,
      });

      return reply.status(201).send({
        message: "Account created. Check your email to verify it.",
        user: result.user,
      });
    },
  );

  app.post(
    "/verify-email",
    { config: { rateLimit: routeRateLimit(20, "15 minutes") } },
    async (request, reply) => {
      assertTrustedOrigin(request);
      const input = verifyEmailSchema.parse(request.body);
      const result = await verifyEmail(input.token);

      await recordAuditEvent({
        action: "auth.email_verified",
        actorUserId: result.userId,
        entityType: "user",
        entityId: result.userId,
        ip: request.ip,
        userAgent: request.headers["user-agent"],
        requestId: request.id,
      });

      return reply.send({ message: "Email verified." });
    },
  );

  app.post(
    "/resend-verification",
    { config: { rateLimit: routeRateLimit(5, "15 minutes") } },
    async (request, reply) => {
      assertTrustedOrigin(request);
      const input = resendVerificationSchema.parse(request.body);
      await resendVerificationEmail(input.email);

      return reply.status(202).send({
        message:
          "If the account exists and is pending verification, a new verification email has been sent.",
      });
    },
  );

  app.post(
    "/login",
    { config: { rateLimit: routeRateLimit(10, "15 minutes") } },
    async (request, reply) => {
      assertTrustedOrigin(request);
      const input = loginSchema.parse(request.body);
      const result = await loginUser(input, sessionMeta(request));

      setRefreshCookie(reply, result.session.refreshToken);

      await recordAuditEvent({
        action: "auth.login",
        actorUserId: result.user.id,
        entityType: "user",
        entityId: result.user.id,
        ip: request.ip,
        userAgent: request.headers["user-agent"],
        requestId: request.id,
      });

      return reply.send(buildAuthResponse(app, result));
    },
  );

  app.post(
    "/refresh",
    { config: { rateLimit: routeRateLimit(60, "15 minutes") } },
    async (request, reply) => {
      assertTrustedOrigin(request);
      const refreshToken = readRefreshToken(request);

      if (!refreshToken) {
        throw new AppError({
          statusCode: 401,
          code: "INVALID_REFRESH_TOKEN",
          message: "The refresh token is missing.",
        });
      }

      try {
        const result = await refreshSession(refreshToken, sessionMeta(request));
        setRefreshCookie(reply, result.session.refreshToken);
        return reply.send(buildAuthResponse(app, result));
      } catch (error) {
        clearRefreshCookie(reply);
        throw error;
      }
    },
  );

  app.post(
    "/logout",
    { config: { rateLimit: routeRateLimit(30, "15 minutes") } },
    async (request, reply) => {
      assertTrustedOrigin(request);
      const input = logoutSchema.parse(request.body ?? {});
      const refreshToken = readRefreshToken(request);
      const result = refreshToken ? await logoutSession(refreshToken, input.allDevices) : null;

      clearRefreshCookie(reply);

      if (result) {
        await recordAuditEvent({
          action: input.allDevices ? "auth.logout_all" : "auth.logout",
          actorUserId: result.userId,
          entityType: "user",
          entityId: result.userId,
          ip: request.ip,
          userAgent: request.headers["user-agent"],
          requestId: request.id,
        });
      }

      return reply.status(204).send();
    },
  );

  app.post(
    "/forgot-password",
    { config: { rateLimit: routeRateLimit(5, "15 minutes") } },
    async (request, reply) => {
      assertTrustedOrigin(request);
      const input = forgotPasswordSchema.parse(request.body);
      await requestPasswordReset(input.email);

      return reply.status(202).send({
        message: "If the email exists, a password reset link has been sent.",
      });
    },
  );

  app.post(
    "/reset-password",
    { config: { rateLimit: routeRateLimit(10, "15 minutes") } },
    async (request, reply) => {
      assertTrustedOrigin(request);
      const input = resetPasswordSchema.parse(request.body);
      const result = await resetPassword(input.token, input.newPassword);

      clearRefreshCookie(reply);

      await recordAuditEvent({
        action: "auth.password_reset",
        actorUserId: result.userId,
        entityType: "user",
        entityId: result.userId,
        ip: request.ip,
        userAgent: request.headers["user-agent"],
        requestId: request.id,
      });

      return reply.send({ message: "Password updated. Sign in again." });
    },
  );

  app.get("/me", { preHandler: authenticate }, async (request) => {
    const user = await getUserById(request.user.sub);

    if (!user) {
      throw new AppError({
        statusCode: 401,
        code: "UNAUTHENTICATED",
        message: "Authentication required.",
      });
    }

    return { user };
  });
};
