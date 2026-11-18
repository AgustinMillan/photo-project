import { and, asc, desc, eq, inArray, isNull, max, ne, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { albums, auditLogs, mediaAssets, photos, photoVersions } from "../../db/schema/index.js";
import { AppError } from "../../shared/errors/app-error.js";
import { getStoreDraft, mediaUrl } from "../storefront/storefront.service.js";
import type { StoreAccess } from "../stores/store-access.js";
import type {
  BulkUpdatePhotosInput,
  CreateAlbumInput,
  UpdateAlbumInput,
  UpdatePhotoInput,
} from "./catalog.schemas.js";
import { discardProcessedImage, processImage, writeProcessedImage } from "./media.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function notFound(code: string, message: string): AppError {
  return new AppError({ statusCode: 404, code, message });
}

async function audit(
  access: StoreAccess,
  action: string,
  entityType: string,
  entityId: string,
  data: { before?: Record<string, unknown>; after?: Record<string, unknown> } = {},
  tx: Tx | typeof db = db,
) {
  await tx.insert(auditLogs).values({
    accountId: access.account.id,
    storeId: access.store.id,
    actorUserId: access.userId,
    action,
    entityType,
    entityId,
    before: data.before ?? null,
    after: data.after ?? null,
  });
}

async function requireAlbum(storeId: string, albumId: string) {
  const [album] = await db
    .select()
    .from(albums)
    .where(and(eq(albums.id, albumId), eq(albums.storeId, storeId)))
    .limit(1);
  if (!album) throw notFound("ALBUM_NOT_FOUND", "The album was not found.");
  return album;
}

async function requirePhoto(storeId: string, photoId: string) {
  const [photo] = await db
    .select()
    .from(photos)
    .where(and(eq(photos.id, photoId), eq(photos.storeId, storeId)))
    .limit(1);
  if (!photo) throw notFound("PHOTO_NOT_FOUND", "The photo was not found.");
  return photo;
}

// ---------------------------------------------------------------------------
// Albums
// ---------------------------------------------------------------------------

export async function listAlbums(access: StoreAccess) {
  return db
    .select({
      id: albums.id,
      title: albums.title,
      description: albums.description,
      priceCents: albums.priceCents,
      status: albums.status,
      sortOrder: albums.sortOrder,
      coverPhotoId: albums.coverPhotoId,
      createdAt: albums.createdAt,
      photoCount: sql<number>`(select count(*)::int from ${photos} p where p.album_id = ${albums.id} and p.status <> 'archived')`,
      publishedCount: sql<number>`(select count(*)::int from ${photos} p where p.album_id = ${albums.id} and p.status = 'published')`,
      coverAssetId: sql<
        string | null
      >`(select v.media_asset_id from ${photoVersions} v join ${photos} p on p.id = v.photo_id where v.is_current and p.album_id = ${albums.id} and p.status <> 'archived' order by (p.id = ${albums.coverPhotoId}) desc, p.sort_order, p.created_at limit 1)`,
    })
    .from(albums)
    .where(and(eq(albums.storeId, access.store.id), ne(albums.status, "archived")))
    .orderBy(asc(albums.sortOrder), desc(albums.createdAt))
    .then((rows) =>
      rows.map(({ coverAssetId, ...album }) => ({
        ...album,
        coverUrl: coverAssetId ? mediaUrl(coverAssetId, "thumb") : null,
      })),
    );
}

export async function createAlbum(access: StoreAccess, input: CreateAlbumInput) {
  const [album] = await db
    .insert(albums)
    .values({
      storeId: access.store.id,
      title: input.title,
      description: input.description ?? "",
      priceCents: input.priceCents ?? null,
      status: input.status ?? "draft",
    })
    .returning();
  if (!album) throw new Error("Album insert returned no row.");
  await audit(access, "album.created", "album", album.id, { after: { title: album.title } });
  return album;
}

export async function updateAlbum(access: StoreAccess, albumId: string, input: UpdateAlbumInput) {
  const before = await requireAlbum(access.store.id, albumId);

  if (input.coverPhotoId) {
    const cover = await requirePhoto(access.store.id, input.coverPhotoId);
    if (cover.albumId !== albumId) {
      throw new AppError({
        statusCode: 400,
        code: "COVER_NOT_IN_ALBUM",
        message: "The cover photo must belong to the album.",
      });
    }
  }

  const [album] = await db
    .update(albums)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(albums.id, albumId), eq(albums.storeId, access.store.id)))
    .returning();
  await audit(access, "album.updated", "album", albumId, {
    before: { status: before.status, priceCents: before.priceCents },
    after: { status: album?.status, priceCents: album?.priceCents },
  });
  return album;
}

/**
 * Two deliberately different removals:
 * - "release": the album is archived and its photos stay in the catalog without an album.
 * - "archive": the album and all of its photos are archived.
 * Neither deletes rows, so past orders keep their references.
 */
export async function removeAlbum(
  access: StoreAccess,
  albumId: string,
  mode: "release" | "archive",
) {
  await requireAlbum(access.store.id, albumId);
  const now = new Date();

  return db.transaction(async (tx) => {
    const affected =
      mode === "release"
        ? await tx
            .update(photos)
            .set({ albumId: null, updatedAt: now })
            .where(and(eq(photos.albumId, albumId), eq(photos.storeId, access.store.id)))
            .returning({ id: photos.id })
        : await tx
            .update(photos)
            .set({ status: "archived", updatedAt: now })
            .where(and(eq(photos.albumId, albumId), eq(photos.storeId, access.store.id)))
            .returning({ id: photos.id });

    await tx
      .update(albums)
      .set({ status: "archived", coverPhotoId: null, updatedAt: now })
      .where(and(eq(albums.id, albumId), eq(albums.storeId, access.store.id)));

    await audit(
      access,
      mode === "release" ? "album.removed_releasing_photos" : "album.archived_with_photos",
      "album",
      albumId,
      { after: { mode, photoIds: affected.map((row) => row.id) } },
      tx,
    );

    return { mode, affectedPhotos: affected.length };
  });
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

export async function listPhotos(
  access: StoreAccess,
  filter: { albumId?: string; unassigned?: boolean },
) {
  const rows = await db
    .select({
      id: photos.id,
      title: photos.title,
      priceCents: photos.priceCents,
      status: photos.status,
      albumId: photos.albumId,
      sortOrder: photos.sortOrder,
      createdAt: photos.createdAt,
      version: photoVersions.version,
      assetId: photoVersions.mediaAssetId,
      width: mediaAssets.width,
      height: mediaAssets.height,
      originalFilename: mediaAssets.originalFilename,
    })
    .from(photos)
    .innerJoin(
      photoVersions,
      and(eq(photoVersions.photoId, photos.id), eq(photoVersions.isCurrent, true)),
    )
    .innerJoin(mediaAssets, eq(mediaAssets.id, photoVersions.mediaAssetId))
    .where(
      and(
        eq(photos.storeId, access.store.id),
        ne(photos.status, "archived"),
        filter.albumId ? eq(photos.albumId, filter.albumId) : undefined,
        filter.unassigned ? isNull(photos.albumId) : undefined,
      ),
    )
    .orderBy(asc(photos.sortOrder), asc(photos.createdAt))
    .limit(1000);

  return rows.map(({ assetId, ...photo }) => ({
    ...photo,
    thumbUrl: mediaUrl(assetId, "thumb"),
    previewUrl: mediaUrl(assetId, "preview"),
  }));
}

function titleFromFilename(filename: string): string {
  return filename
    .replace(/\.[A-Za-z0-9]+$/, "")
    .replace(/[_-]+/g, " ")
    .trim()
    .slice(0, 120);
}

export async function uploadPhoto(
  access: StoreAccess,
  file: { buffer: Buffer; filename: string },
  options: { albumId?: string; priceCents?: number | null; status?: "draft" | "published" },
) {
  if (options.albumId) await requireAlbum(access.store.id, options.albumId);

  const draft = await getStoreDraft(access.store.id);
  const image = await processImage(access.store.id, file.buffer, draft.watermarkText);
  await writeProcessedImage(image);

  try {
    return await db.transaction(async (tx) => {
      await tx.insert(mediaAssets).values({
        id: image.assetId,
        storeId: access.store.id,
        originalKey: image.originalKey,
        mimeType: image.mimeType,
        bytes: image.bytes,
        width: image.width,
        height: image.height,
        checksumSha256: image.checksumSha256,
        originalFilename: file.filename.slice(0, 255),
        uploadedByUserId: access.userId,
      });

      const [order] = await tx
        .select({ value: max(photos.sortOrder) })
        .from(photos)
        .where(eq(photos.storeId, access.store.id));

      const [photo] = await tx
        .insert(photos)
        .values({
          storeId: access.store.id,
          albumId: options.albumId ?? null,
          title: titleFromFilename(file.filename),
          priceCents: options.priceCents ?? null,
          status: options.status ?? "draft",
          sortOrder: (order?.value ?? 0) + 1,
        })
        .returning();
      if (!photo) throw new Error("Photo insert returned no row.");

      await tx.insert(photoVersions).values({
        photoId: photo.id,
        storeId: access.store.id,
        mediaAssetId: image.assetId,
        version: 1,
        isCurrent: true,
      });

      await audit(
        access,
        "photo.uploaded",
        "photo",
        photo.id,
        { after: { assetId: image.assetId } },
        tx,
      );

      return {
        ...photo,
        version: 1,
        thumbUrl: mediaUrl(image.assetId, "thumb"),
        previewUrl: mediaUrl(image.assetId, "preview"),
      };
    });
  } catch (error) {
    await discardProcessedImage(image);
    throw error;
  }
}

/**
 * Replacing a photo processes the new file first and only then swaps the
 * current version in one transaction. Previous assets and versions are kept,
 * so earlier buyers still download what they paid for.
 */
export async function replacePhoto(
  access: StoreAccess,
  photoId: string,
  file: { buffer: Buffer; filename: string },
) {
  const photo = await requirePhoto(access.store.id, photoId);
  const draft = await getStoreDraft(access.store.id);
  const image = await processImage(access.store.id, file.buffer, draft.watermarkText);
  await writeProcessedImage(image);

  try {
    return await db.transaction(async (tx) => {
      await tx.select({ id: photos.id }).from(photos).where(eq(photos.id, photo.id)).for("update");

      await tx.insert(mediaAssets).values({
        id: image.assetId,
        storeId: access.store.id,
        originalKey: image.originalKey,
        mimeType: image.mimeType,
        bytes: image.bytes,
        width: image.width,
        height: image.height,
        checksumSha256: image.checksumSha256,
        originalFilename: file.filename.slice(0, 255),
        uploadedByUserId: access.userId,
      });

      const [last] = await tx
        .select({ value: max(photoVersions.version) })
        .from(photoVersions)
        .where(eq(photoVersions.photoId, photo.id));
      const version = (last?.value ?? 0) + 1;

      await tx
        .update(photoVersions)
        .set({ isCurrent: false })
        .where(and(eq(photoVersions.photoId, photo.id), eq(photoVersions.isCurrent, true)));
      await tx.insert(photoVersions).values({
        photoId: photo.id,
        storeId: access.store.id,
        mediaAssetId: image.assetId,
        version,
        isCurrent: true,
      });
      await tx.update(photos).set({ updatedAt: new Date() }).where(eq(photos.id, photo.id));

      await audit(
        access,
        "photo.replaced",
        "photo",
        photo.id,
        { after: { version, assetId: image.assetId } },
        tx,
      );

      return { id: photo.id, version, thumbUrl: mediaUrl(image.assetId, "thumb") };
    });
  } catch (error) {
    await discardProcessedImage(image);
    throw error;
  }
}

export async function updatePhoto(access: StoreAccess, photoId: string, input: UpdatePhotoInput) {
  const before = await requirePhoto(access.store.id, photoId);
  if (input.albumId) await requireAlbum(access.store.id, input.albumId);

  const [photo] = await db
    .update(photos)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(photos.id, photoId), eq(photos.storeId, access.store.id)))
    .returning();

  if (input.status === "archived" || input.albumId !== undefined) {
    // An archived or moved photo cannot remain the cover of its old album.
    await db
      .update(albums)
      .set({ coverPhotoId: null })
      .where(and(eq(albums.coverPhotoId, photoId), eq(albums.storeId, access.store.id)));
  }

  await audit(access, "photo.updated", "photo", photoId, {
    before: { status: before.status, priceCents: before.priceCents, albumId: before.albumId },
    after: { status: photo?.status, priceCents: photo?.priceCents, albumId: photo?.albumId },
  });
  return photo;
}

export async function bulkUpdatePhotos(access: StoreAccess, input: BulkUpdatePhotosInput) {
  const { photoIds, ...changes } = input;
  const updated = await db
    .update(photos)
    .set({ ...changes, updatedAt: new Date() })
    .where(and(eq(photos.storeId, access.store.id), inArray(photos.id, photoIds)))
    .returning({ id: photos.id });

  await db.insert(auditLogs).values({
    accountId: access.account.id,
    storeId: access.store.id,
    actorUserId: access.userId,
    action: "photo.bulk_updated",
    entityType: "photo",
    after: { ...changes, photoIds: updated.map((row) => row.id) },
  });

  return { updated: updated.length };
}
