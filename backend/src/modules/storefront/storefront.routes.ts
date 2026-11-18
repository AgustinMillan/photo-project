import type { FastifyPluginAsync } from "fastify";
import { assertTrustedOrigin } from "../../shared/http/origin.js";
import { routeRateLimit } from "../../shared/http/rate-limit.js";
import { authenticate } from "../auth/auth.guard.js";
import { requireActiveUser } from "../auth/auth.service.js";
import { requireStoreAccess } from "../stores/store-access.js";
import { storeParamsSchema } from "../stores/stores.schemas.js";
import { albumParamsSchema, updateStorefrontSchema } from "./storefront.schemas.js";
import {
  getPublicAlbum,
  getPublicStorefront,
  getStorefrontAdmin,
  publishStorefront,
  unpublishStorefront,
  updateStorefrontDraft,
} from "./storefront.service.js";

const EDITOR_ROLES = ["OWNER", "ADMIN"] as const;

export const storefrontRoutes: FastifyPluginAsync = async (app) => {
  app.get("/stores/:storeId/storefront", { preHandler: authenticate }, async (request) => {
    const user = await requireActiveUser(request.user.sub);
    const { storeId } = storeParamsSchema.parse(request.params);
    const access = await requireStoreAccess(user.id, storeId);
    return getStorefrontAdmin(access);
  });

  app.put("/stores/:storeId/storefront", { preHandler: authenticate }, async (request) => {
    assertTrustedOrigin(request);
    const user = await requireActiveUser(request.user.sub);
    const { storeId } = storeParamsSchema.parse(request.params);
    const access = await requireStoreAccess(user.id, storeId, EDITOR_ROLES);
    const draft = await updateStorefrontDraft(access, updateStorefrontSchema.parse(request.body));
    return { draft };
  });

  app.post("/stores/:storeId/storefront/publish", { preHandler: authenticate }, async (request) => {
    assertTrustedOrigin(request);
    const user = await requireActiveUser(request.user.sub);
    const { storeId } = storeParamsSchema.parse(request.params);
    const access = await requireStoreAccess(user.id, storeId, EDITOR_ROLES);
    return { publication: await publishStorefront(access) };
  });

  app.post(
    "/stores/:storeId/storefront/unpublish",
    { preHandler: authenticate },
    async (request) => {
      assertTrustedOrigin(request);
      const user = await requireActiveUser(request.user.sub);
      const { storeId } = storeParamsSchema.parse(request.params);
      const access = await requireStoreAccess(user.id, storeId, EDITOR_ROLES);
      await unpublishStorefront(access);
      return { publicationStatus: "unpublished" };
    },
  );

  app.get(
    "/public/storefront",
    { config: { rateLimit: routeRateLimit(240, "1 minute") } },
    async (request) => getPublicStorefront(request.hostname),
  );

  app.get(
    "/public/albums/:albumId",
    { config: { rateLimit: routeRateLimit(240, "1 minute") } },
    async (request) => {
      const { albumId } = albumParamsSchema.parse(request.params);
      return getPublicAlbum(request.hostname, albumId);
    },
  );
};
