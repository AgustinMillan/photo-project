import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { AppError } from "../../shared/errors/app-error.js";
import { assertTrustedOrigin } from "../../shared/http/origin.js";
import { routeRateLimit } from "../../shared/http/rate-limit.js";
import { authenticate } from "../auth/auth.guard.js";
import { requireActiveUser } from "../auth/auth.service.js";
import {
  acceptStoreInvitation,
  createStoreInvitation,
  listStoreInvitations,
  revokeStoreInvitation,
} from "./invitations.service.js";
import { listStoreMembers, removeStoreMember, updateStoreMember } from "./memberships.service.js";
import { requireStoreAccess } from "./store-access.js";
import { normalizeHostname } from "./stores.constants.js";
import {
  acceptStoreInvitationSchema,
  createStoreInvitationSchema,
  createStoreSchema,
  storeInvitationParamsSchema,
  storeMemberParamsSchema,
  storeParamsSchema,
  updateStoreMemberSchema,
  updateStoreSchema,
} from "./stores.schemas.js";
import {
  createStore,
  getAccessibleStores,
  resolveStoreByHostname,
  storeViewFromAccess,
  updateStore,
} from "./stores.service.js";

async function activeUser(request: FastifyRequest) {
  return requireActiveUser(request.user.sub);
}

export const storesRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/stores",
    {
      preHandler: authenticate,
      config: { rateLimit: routeRateLimit(10, "1 hour") },
    },
    async (request, reply) => {
      assertTrustedOrigin(request);
      const user = await activeUser(request);
      const input = createStoreSchema.parse(request.body);
      const store = await createStore(user.id, input);

      return reply.status(201).send({ store });
    },
  );

  app.get("/stores", { preHandler: authenticate }, async (request) => {
    const user = await activeUser(request);
    const stores = await getAccessibleStores(user.id);

    return { stores };
  });

  app.get("/stores/:storeId", { preHandler: authenticate }, async (request) => {
    const user = await activeUser(request);
    const { storeId } = storeParamsSchema.parse(request.params);
    const access = await requireStoreAccess(user.id, storeId);

    return { store: storeViewFromAccess(access) };
  });

  app.patch("/stores/:storeId", { preHandler: authenticate }, async (request) => {
    assertTrustedOrigin(request);
    const user = await activeUser(request);
    const { storeId } = storeParamsSchema.parse(request.params);
    const access = await requireStoreAccess(user.id, storeId, ["OWNER", "ADMIN"]);
    const input = updateStoreSchema.parse(request.body);
    const store = await updateStore(user.id, access, input);

    return { store };
  });

  app.get("/stores/:storeId/members", { preHandler: authenticate }, async (request) => {
    const user = await activeUser(request);
    const { storeId } = storeParamsSchema.parse(request.params);
    const access = await requireStoreAccess(user.id, storeId, ["OWNER", "ADMIN"]);
    const members = await listStoreMembers(access);

    return { members };
  });

  app.patch("/stores/:storeId/members/:userId", { preHandler: authenticate }, async (request) => {
    assertTrustedOrigin(request);
    const user = await activeUser(request);
    const { storeId, userId } = storeMemberParamsSchema.parse(request.params);
    const access = await requireStoreAccess(user.id, storeId, ["OWNER", "ADMIN"]);
    const input = updateStoreMemberSchema.parse(request.body);
    const member = await updateStoreMember(access, userId, input);

    return { member };
  });

  app.delete(
    "/stores/:storeId/members/:userId",
    { preHandler: authenticate },
    async (request, reply) => {
      assertTrustedOrigin(request);
      const user = await activeUser(request);
      const { storeId, userId } = storeMemberParamsSchema.parse(request.params);
      const access = await requireStoreAccess(user.id, storeId, ["OWNER", "ADMIN"]);
      await removeStoreMember(access, userId);

      return reply.status(204).send();
    },
  );

  app.get("/stores/:storeId/invitations", { preHandler: authenticate }, async (request) => {
    const user = await activeUser(request);
    const { storeId } = storeParamsSchema.parse(request.params);
    const access = await requireStoreAccess(user.id, storeId, ["OWNER", "ADMIN"]);
    const invitations = await listStoreInvitations(access);

    return { invitations };
  });

  app.post(
    "/stores/:storeId/invitations",
    {
      preHandler: authenticate,
      config: { rateLimit: routeRateLimit(30, "1 hour") },
    },
    async (request, reply) => {
      assertTrustedOrigin(request);
      const user = await activeUser(request);
      const { storeId } = storeParamsSchema.parse(request.params);
      const access = await requireStoreAccess(user.id, storeId, ["OWNER", "ADMIN"]);
      const input = createStoreInvitationSchema.parse(request.body);
      const invitation = await createStoreInvitation(access, user, input);

      return reply.status(201).send({ invitation });
    },
  );

  app.delete(
    "/stores/:storeId/invitations/:invitationId",
    { preHandler: authenticate },
    async (request, reply) => {
      assertTrustedOrigin(request);
      const user = await activeUser(request);
      const { storeId, invitationId } = storeInvitationParamsSchema.parse(request.params);
      const access = await requireStoreAccess(user.id, storeId, ["OWNER", "ADMIN"]);
      await revokeStoreInvitation(access, invitationId);

      return reply.status(204).send();
    },
  );

  app.post(
    "/invitations/accept",
    {
      preHandler: authenticate,
      config: { rateLimit: routeRateLimit(20, "15 minutes") },
    },
    async (request) => {
      assertTrustedOrigin(request);
      const user = await activeUser(request);
      const { token } = acceptStoreInvitationSchema.parse(request.body);
      const accepted = await acceptStoreInvitation(user, token);

      return {
        store: {
          id: accepted.storeId,
          name: accepted.storeName,
          slug: accepted.storeSlug,
        },
        role: accepted.role,
      };
    },
  );

  app.get(
    "/public/stores/resolve",
    { config: { rateLimit: routeRateLimit(120, "1 minute") } },
    async (request) => {
      const hostname = normalizeHostname(request.hostname);

      if (!hostname) {
        throw new AppError({
          statusCode: 400,
          code: "HOSTNAME_REQUIRED",
          message: "A hostname is required to resolve a store.",
        });
      }

      const store = await resolveStoreByHostname(hostname);

      if (!store) {
        throw new AppError({
          statusCode: 404,
          code: "STORE_NOT_FOUND",
          message: "No store is available for this hostname.",
        });
      }

      return { store };
    },
  );
};
