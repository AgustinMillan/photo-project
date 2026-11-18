import type { FastifyPluginAsync } from "fastify";
import { AppError } from "../../shared/errors/app-error.js";
import { assertTrustedOrigin } from "../../shared/http/origin.js";
import { routeRateLimit } from "../../shared/http/rate-limit.js";
import { authenticate } from "../auth/auth.guard.js";
import { requireActiveUser } from "../auth/auth.service.js";
import { createAccountSchema, updateAccountSchema } from "./accounts.schemas.js";
import { createAccount, getAccountForUser, updateAccount } from "./accounts.service.js";

export const accountsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/accounts/me", { preHandler: authenticate }, async (request) => {
    const user = await requireActiveUser(request.user.sub);
    const account = await getAccountForUser(user.id);

    if (!account) {
      throw new AppError({
        statusCode: 404,
        code: "ACCOUNT_NOT_FOUND",
        message: "The account was not found.",
      });
    }

    return { account };
  });

  app.post(
    "/accounts",
    {
      preHandler: authenticate,
      config: { rateLimit: routeRateLimit(5, "1 hour") },
    },
    async (request, reply) => {
      assertTrustedOrigin(request);
      const user = await requireActiveUser(request.user.sub);
      const input = createAccountSchema.parse(request.body);
      const account = await createAccount(user, input);

      return reply.status(201).send({ account });
    },
  );

  app.patch("/accounts/me", { preHandler: authenticate }, async (request) => {
    assertTrustedOrigin(request);
    const user = await requireActiveUser(request.user.sub);
    const input = updateAccountSchema.parse(request.body);
    const account = await updateAccount(user.id, input);

    return { account };
  });
};
