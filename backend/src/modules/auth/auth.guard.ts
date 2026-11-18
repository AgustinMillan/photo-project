import type { FastifyRequest } from "fastify";
import { AppError } from "../../shared/errors/app-error.js";

export type AccessTokenPayload = {
  sub: string;
  sid: string;
  type: "access";
};

export async function authenticate(request: FastifyRequest): Promise<void> {
  try {
    const payload = await request.jwtVerify<AccessTokenPayload>();

    if (payload.type !== "access" || !payload.sub || !payload.sid) {
      throw new Error("Invalid access token payload");
    }
  } catch {
    throw new AppError({
      statusCode: 401,
      code: "UNAUTHENTICATED",
      message: "Authentication required.",
    });
  }
}
