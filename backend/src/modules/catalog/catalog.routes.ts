import { timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { AppError } from "../../shared/errors/app-error.js";
import { assertTrustedOrigin } from "../../shared/http/origin.js";
import { routeRateLimit } from "../../shared/http/rate-limit.js";
import { authenticate } from "../auth/auth.guard.js";
import { requireActiveUser } from "../auth/auth.service.js";
import { resolveStyledMedia, thumbSignature } from "../storefront/storefront.service.js";
import { requireStoreAccess } from "../stores/store-access.js";
import { storeParamsSchema } from "../stores/stores.schemas.js";
import {
  albumIdParamsSchema,
  bulkUpdatePhotosSchema,
  createAlbumSchema,
  listPhotosQuerySchema,
  mediaParamsSchema,
  photoIdParamsSchema,
  removeAlbumQuerySchema,
  styledMediaParamsSchema,
  updateAlbumSchema,
  updatePhotoSchema,
  uploadPhotoQuerySchema,
} from "./catalog.schemas.js";
import {
  bulkUpdatePhotos,
  createAlbum,
  listAlbums,
  listPhotos,
  removeAlbum,
  replacePhoto,
  updateAlbum,
  updatePhoto,
  uploadPhoto,
} from "./catalog.service.js";
import { derivedPath, type MediaVariant } from "./media.js";

const CATALOG_ROLES = ["OWNER", "ADMIN", "PHOTOGRAPHER", "EDITOR"] as const;

async function catalogAccess(request: FastifyRequest, storeId: string) {
  const user = await requireActiveUser(request.user.sub);
  return requireStoreAccess(user.id, storeId, CATALOG_ROLES);
}

async function readUpload(request: FastifyRequest) {
  const file = await request.file();
  if (!file) {
    throw new AppError({ statusCode: 400, code: "FILE_REQUIRED", message: "A file is required." });
  }
  try {
    return { buffer: await file.toBuffer(), filename: file.filename || "foto" };
  } catch {
    throw new AppError({
      statusCode: 413,
      code: "FILE_TOO_LARGE",
      message: "The file exceeds the maximum upload size.",
    });
  }
}

export const catalogRoutes: FastifyPluginAsync = async (app) => {
  // --- Albums -------------------------------------------------------------
  app.get("/stores/:storeId/albums", { preHandler: authenticate }, async (request) => {
    const { storeId } = storeParamsSchema.parse(request.params);
    return { albums: await listAlbums(await catalogAccess(request, storeId)) };
  });

  app.post("/stores/:storeId/albums", { preHandler: authenticate }, async (request, reply) => {
    assertTrustedOrigin(request);
    const { storeId } = storeParamsSchema.parse(request.params);
    const access = await catalogAccess(request, storeId);
    const album = await createAlbum(access, createAlbumSchema.parse(request.body));
    return reply.status(201).send({ album });
  });

  app.patch("/stores/:storeId/albums/:albumId", { preHandler: authenticate }, async (request) => {
    assertTrustedOrigin(request);
    const { storeId, albumId } = albumIdParamsSchema.parse(request.params);
    const access = await catalogAccess(request, storeId);
    return { album: await updateAlbum(access, albumId, updateAlbumSchema.parse(request.body)) };
  });

  app.delete("/stores/:storeId/albums/:albumId", { preHandler: authenticate }, async (request) => {
    assertTrustedOrigin(request);
    const { storeId, albumId } = albumIdParamsSchema.parse(request.params);
    const { mode } = removeAlbumQuerySchema.parse(request.query);
    const access = await catalogAccess(request, storeId);
    return removeAlbum(access, albumId, mode);
  });

  // --- Photos -------------------------------------------------------------
  app.get("/stores/:storeId/photos", { preHandler: authenticate }, async (request) => {
    const { storeId } = storeParamsSchema.parse(request.params);
    const query = listPhotosQuerySchema.parse(request.query);
    const access = await catalogAccess(request, storeId);
    return {
      photos: await listPhotos(access, {
        albumId: query.albumId,
        unassigned: Boolean(query.unassigned),
        archived: Boolean(query.archived),
      }),
    };
  });

  app.post(
    "/stores/:storeId/photos",
    { preHandler: authenticate, config: { rateLimit: routeRateLimit(600, "1 hour") } },
    async (request, reply) => {
      assertTrustedOrigin(request);
      const { storeId } = storeParamsSchema.parse(request.params);
      const options = uploadPhotoQuerySchema.parse(request.query);
      const access = await catalogAccess(request, storeId);
      const photo = await uploadPhoto(access, await readUpload(request), options);
      return reply.status(201).send({ photo });
    },
  );

  app.post(
    "/stores/:storeId/photos/:photoId/replace",
    { preHandler: authenticate, config: { rateLimit: routeRateLimit(120, "1 hour") } },
    async (request) => {
      assertTrustedOrigin(request);
      const { storeId, photoId } = photoIdParamsSchema.parse(request.params);
      const access = await catalogAccess(request, storeId);
      return { photo: await replacePhoto(access, photoId, await readUpload(request)) };
    },
  );

  app.patch("/stores/:storeId/photos/:photoId", { preHandler: authenticate }, async (request) => {
    assertTrustedOrigin(request);
    const { storeId, photoId } = photoIdParamsSchema.parse(request.params);
    const access = await catalogAccess(request, storeId);
    return { photo: await updatePhoto(access, photoId, updatePhotoSchema.parse(request.body)) };
  });

  app.post("/stores/:storeId/photos/bulk", { preHandler: authenticate }, async (request) => {
    assertTrustedOrigin(request);
    const { storeId } = storeParamsSchema.parse(request.params);
    const access = await catalogAccess(request, storeId);
    return bulkUpdatePhotos(access, bulkUpdatePhotosSchema.parse(request.body));
  });

  // --- Public derivatives (thumbnail and watermarked preview only) --------
  app.get(
    "/public/media/:assetId/:variant",
    { config: { rateLimit: routeRateLimit(1200, "1 minute") } },
    async (request, reply) => {
      const parsed = mediaParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        throw new AppError({ statusCode: 404, code: "MEDIA_NOT_FOUND", message: "Not found." });
      }
      const variant = parsed.data.variant.replace(".webp", "") as MediaVariant;
      // The clean thumbnail is only for the panel (and buyers): it needs a signature.
      if (variant === "thumb") {
        const { sig } = request.query as { sig?: string };
        const expected = thumbSignature(parsed.data.assetId);
        if (
          typeof sig !== "string" ||
          sig.length !== expected.length ||
          !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
        ) {
          throw new AppError({ statusCode: 404, code: "MEDIA_NOT_FOUND", message: "Not found." });
        }
      }
      const file = derivedPath(parsed.data.assetId, variant);
      const info = await stat(file).catch(() => null);
      if (!info) {
        throw new AppError({ statusCode: 404, code: "MEDIA_NOT_FOUND", message: "Not found." });
      }
      return reply
        .header("content-type", "image/webp")
        .header("content-length", info.size)
        .header("cache-control", "public, max-age=31536000, immutable")
        // Our own sites (landing + every store) may show it; other sites still cannot.
        .header("cross-origin-resource-policy", "same-site")
        .send(createReadStream(file));
    },
  );

  // --- Protected previews (watermark / black & white as the store chose) ---
  app.get(
    "/public/media/:assetId/s/:style",
    { config: { rateLimit: routeRateLimit(1200, "1 minute") } },
    async (request, reply) => {
      const params = styledMediaParamsSchema.safeParse(request.params);
      const file = params.success
        ? await resolveStyledMedia(params.data.assetId, params.data.style.replace(/\.webp$/, ""))
        : null;
      const info = file ? await stat(file).catch(() => null) : null;
      if (!file || !info) {
        throw new AppError({ statusCode: 404, code: "MEDIA_NOT_FOUND", message: "Not found." });
      }
      return reply
        .header("content-type", "image/webp")
        .header("content-length", info.size)
        .header("cache-control", "public, max-age=31536000, immutable")
        // Our own sites (landing + every store) may show it; other sites still cannot.
        .header("cross-origin-resource-policy", "same-site")
        .send(createReadStream(file));
    },
  );
};
