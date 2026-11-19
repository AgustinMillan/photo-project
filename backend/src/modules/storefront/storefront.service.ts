import { access } from "node:fs/promises";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  albums,
  auditLogs,
  mediaAssets,
  photos,
  photoVersions,
  STOREFRONT_SECTION_KEYS,
  type StorefrontContent,
  storeProfiles,
  storePublications,
  stores,
} from "../../db/schema/index.js";
import { AppError } from "../../shared/errors/app-error.js";
import { SECTIONS_REORDER_FEATURE } from "../billing/billing.constants.js";
import { getEffectiveEntitlement, getStoreSalesStatus } from "../billing/billing.service.js";
import { derivedPath, ensureCoverVariant } from "../catalog/media.js";
import { storePaymentOptions } from "../payments/payment-options.js";
import type { StoreAccess } from "../stores/store-access.js";
import { normalizeHostname } from "../stores/stores.constants.js";
import { resolveStoreByHostname } from "../stores/stores.service.js";
import type { UpdateStorefrontInput } from "./storefront.schemas.js";

export function mediaUrl(assetId: string, variant: "thumb" | "preview" | "cover"): string {
  return `/api/v1/public/media/${assetId}/${variant}.webp`;
}

export function defaultStorefrontContent(storeName: string): StorefrontContent {
  return {
    displayName: storeName,
    tagline: "",
    bio: "",
    contactEmail: "",
    phone: "",
    instagram: "",
    website: "",
    coverPhotoId: null,
    paymentInstructions: "",
    watermarkText: storeName,
    sections: STOREFRONT_SECTION_KEYS.map((key) => ({ key, enabled: true })),
    services: [],
  };
}

/**
 * Content saved before a section existed is upgraded on read: missing sections
 * are inserted at their default position (keeping the store's own order for the
 * rest) and missing lists default to empty.
 */
export function normalizeStorefrontContent(content: StorefrontContent): StorefrontContent {
  const present = new Set(content.sections.map((section) => section.key));
  const sections = [...content.sections].filter((section) =>
    (STOREFRONT_SECTION_KEYS as readonly string[]).includes(section.key),
  );
  STOREFRONT_SECTION_KEYS.forEach((key, index) => {
    if (!present.has(key))
      sections.splice(Math.min(index, sections.length), 0, { key, enabled: true });
  });
  return { ...content, sections, services: content.services ?? [] };
}

async function readDraft(storeId: string, storeName: string): Promise<StorefrontContent> {
  const [profile] = await db
    .select()
    .from(storeProfiles)
    .where(eq(storeProfiles.storeId, storeId))
    .limit(1);
  return normalizeStorefrontContent(profile?.draft ?? defaultStorefrontContent(storeName));
}

/** Draft content used by uploads (watermark) and checkout (payment instructions). */
export async function getStoreDraft(storeId: string): Promise<StorefrontContent> {
  const [store] = await db.select({ name: stores.name }).from(stores).where(eq(stores.id, storeId));
  return readDraft(storeId, store?.name ?? "");
}

async function latestPublication(storeId: string) {
  const [publication] = await db
    .select()
    .from(storePublications)
    .where(eq(storePublications.storeId, storeId))
    .orderBy(desc(storePublications.version))
    .limit(1);
  return publication
    ? { ...publication, content: normalizeStorefrontContent(publication.content) }
    : null;
}

export async function getStorefrontAdmin(access: StoreAccess) {
  const draft = await readDraft(access.store.id, access.store.name);
  const publication = await latestPublication(access.store.id);
  const reorder = await getEffectiveEntitlement(access.account.id, SECTIONS_REORDER_FEATURE);

  return {
    draft,
    publicationStatus: access.store.publicationStatus,
    published: publication
      ? { version: publication.version, publishedAt: publication.createdAt }
      : null,
    canReorderSections: Boolean(reorder?.enabled),
  };
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index]);
}

async function prepareCoverPhoto(storeId: string, photoId: string): Promise<void> {
  const [photo] = await db
    .select({ assetId: mediaAssets.id, originalKey: mediaAssets.originalKey })
    .from(photos)
    .innerJoin(photoVersions, currentVersionJoin)
    .innerJoin(mediaAssets, eq(mediaAssets.id, photoVersions.mediaAssetId))
    .where(and(eq(photos.id, photoId), eq(photos.storeId, storeId)))
    .limit(1);
  if (!photo) {
    throw new AppError({
      statusCode: 400,
      code: "COVER_PHOTO_NOT_FOUND",
      message: "The cover photo does not belong to this store.",
    });
  }
  await ensureCoverVariant(photo.assetId, photo.originalKey);
}

export async function updateStorefrontDraft(
  access: StoreAccess,
  input: UpdateStorefrontInput,
): Promise<StorefrontContent> {
  const keys = input.sections.map((section) => section.key);

  if (new Set(keys).size !== keys.length || keys.length !== STOREFRONT_SECTION_KEYS.length) {
    throw new AppError({
      statusCode: 400,
      code: "INVALID_SECTIONS",
      message: "Every section must appear exactly once.",
    });
  }

  if (!sameOrder(keys, STOREFRONT_SECTION_KEYS)) {
    const reorder = await getEffectiveEntitlement(access.account.id, SECTIONS_REORDER_FEATURE);
    if (!reorder?.enabled) {
      throw new AppError({
        statusCode: 403,
        code: "SECTIONS_REORDER_NOT_ALLOWED",
        message: "Reordering sections is not included in this plan.",
      });
    }
  }

  // The hero and every service image get an un-watermarked cover rendition.
  const coverIds = [
    ...new Set(
      [input.coverPhotoId, ...input.services.map((service) => service.coverPhotoId)].filter(
        (id): id is string => Boolean(id),
      ),
    ),
  ];
  for (const photoId of coverIds) {
    await prepareCoverPhoto(access.store.id, photoId);
  }

  const draft: StorefrontContent = { ...input, coverPhotoId: input.coverPhotoId ?? null };
  const now = new Date();

  await db
    .insert(storeProfiles)
    .values({ storeId: access.store.id, draft, updatedByUserId: access.userId })
    .onConflictDoUpdate({
      target: storeProfiles.storeId,
      set: { draft, updatedByUserId: access.userId, updatedAt: now },
    });

  return draft;
}

export async function publishStorefront(access: StoreAccess) {
  const draft = await readDraft(access.store.id, access.store.name);

  return db.transaction(async (tx) => {
    // Serialize concurrent publications of the same store.
    await tx
      .select({ id: stores.id })
      .from(stores)
      .where(eq(stores.id, access.store.id))
      .for("update");

    const [last] = await tx
      .select({ version: storePublications.version })
      .from(storePublications)
      .where(eq(storePublications.storeId, access.store.id))
      .orderBy(desc(storePublications.version))
      .limit(1);
    const version = (last?.version ?? 0) + 1;
    const now = new Date();

    const [publication] = await tx
      .insert(storePublications)
      .values({
        storeId: access.store.id,
        version,
        content: draft,
        publishedByUserId: access.userId,
      })
      .returning();

    await tx
      .update(stores)
      .set({ publicationStatus: "published", publishedAt: now, updatedAt: now })
      .where(eq(stores.id, access.store.id));

    await tx.insert(auditLogs).values({
      accountId: access.account.id,
      storeId: access.store.id,
      actorUserId: access.userId,
      action: "storefront.published",
      entityType: "store_publication",
      entityId: publication?.id ?? null,
      after: { version },
    });

    return { version, publishedAt: now };
  });
}

export async function unpublishStorefront(access: StoreAccess): Promise<void> {
  const now = new Date();
  await db
    .update(stores)
    .set({ publicationStatus: "unpublished", updatedAt: now })
    .where(eq(stores.id, access.store.id));
  await db.insert(auditLogs).values({
    accountId: access.account.id,
    storeId: access.store.id,
    actorUserId: access.userId,
    action: "storefront.unpublished",
    entityType: "store",
    entityId: access.store.id,
  });
}

// ---------------------------------------------------------------------------
// Public storefront
// ---------------------------------------------------------------------------

export async function requirePublishedStoreByHost(rawHostname: string) {
  const hostname = normalizeHostname(rawHostname);
  const store = hostname ? await resolveStoreByHostname(hostname) : null;

  if (store?.publicationStatus !== "published") {
    throw new AppError({
      statusCode: 404,
      code: "STORE_NOT_FOUND",
      message: "No published store is available for this hostname.",
    });
  }

  return store;
}

const currentVersionJoin = and(
  eq(photoVersions.photoId, photos.id),
  eq(photoVersions.isCurrent, true),
);

export type PublicPhoto = {
  id: string;
  title: string;
  priceCents: number | null;
  albumId: string | null;
  thumbUrl: string;
  previewUrl: string;
};

async function publicPhotos(storeId: string, albumId: string | null): Promise<PublicPhoto[]> {
  const rows = await db
    .select({
      id: photos.id,
      title: photos.title,
      priceCents: photos.priceCents,
      albumId: photos.albumId,
      assetId: photoVersions.mediaAssetId,
    })
    .from(photos)
    .innerJoin(photoVersions, currentVersionJoin)
    .where(
      and(
        eq(photos.storeId, storeId),
        eq(photos.status, "published"),
        albumId ? eq(photos.albumId, albumId) : isNull(photos.albumId),
      ),
    )
    .orderBy(asc(photos.sortOrder), asc(photos.createdAt))
    .limit(500);

  return rows.map(({ assetId, ...photo }) => ({
    ...photo,
    thumbUrl: mediaUrl(assetId, "thumb"),
    previewUrl: mediaUrl(assetId, "preview"),
  }));
}

async function heroUrlForPhoto(storeId: string, photoId: string | null): Promise<string | null> {
  if (!photoId) return null;
  const [row] = await db
    .select({ assetId: photoVersions.mediaAssetId })
    .from(photos)
    .innerJoin(photoVersions, currentVersionJoin)
    .where(and(eq(photos.id, photoId), eq(photos.storeId, storeId)))
    .limit(1);
  if (!row) return null;
  try {
    await access(derivedPath(row.assetId, "cover"));
    return mediaUrl(row.assetId, "cover");
  } catch {
    return mediaUrl(row.assetId, "preview");
  }
}

async function coverUrlForPhoto(storeId: string, photoId: string | null): Promise<string | null> {
  if (!photoId) return null;
  const [row] = await db
    .select({ assetId: photoVersions.mediaAssetId })
    .from(photos)
    .innerJoin(photoVersions, currentVersionJoin)
    .where(and(eq(photos.id, photoId), eq(photos.storeId, storeId)))
    .limit(1);
  return row ? mediaUrl(row.assetId, "preview") : null;
}

export async function getPublicStorefront(rawHostname: string) {
  const store = await requirePublishedStoreByHost(rawHostname);
  const publication = await latestPublication(store.id);

  if (!publication) {
    throw new AppError({
      statusCode: 404,
      code: "STORE_NOT_FOUND",
      message: "No published store is available for this hostname.",
    });
  }

  const { watermarkText: _watermark, paymentInstructions, ...content } = publication.content;
  const payments = await storePaymentOptions(store.id, paymentInstructions);

  const albumRows = await db
    .select({
      id: albums.id,
      title: albums.title,
      description: albums.description,
      priceCents: albums.priceCents,
      coverPhotoId: albums.coverPhotoId,
      photoCount: sql<number>`(select count(*)::int from ${photos} p where p.album_id = "albums"."id" and p.status = 'published')`,
    })
    .from(albums)
    .where(and(eq(albums.storeId, store.id), eq(albums.status, "published")))
    .orderBy(asc(albums.sortOrder), desc(albums.createdAt));

  const albumViews = await Promise.all(
    albumRows.map(async ({ coverPhotoId, ...album }) => ({
      ...album,
      coverUrl:
        (await coverUrlForPhoto(store.id, coverPhotoId)) ??
        (await publicPhotos(store.id, album.id))[0]?.thumbUrl ??
        null,
    })),
  );

  return {
    store: {
      id: store.id,
      name: store.name,
      slug: store.slug,
      purchasesEnabled: store.purchasesEnabled,
      currency: "ARS",
      payments,
    },
    publication: { version: publication.version, publishedAt: publication.createdAt },
    content: {
      ...content,
      coverUrl: await heroUrlForPhoto(store.id, content.coverPhotoId),
      services: await Promise.all(
        content.services.map(async ({ coverPhotoId, ...service }) => ({
          ...service,
          coverUrl: await heroUrlForPhoto(store.id, coverPhotoId),
        })),
      ),
    },
    albums: albumViews.filter((album) => album.photoCount > 0),
    photos: await publicPhotos(store.id, null),
  };
}

export async function getPublicAlbum(rawHostname: string, albumId: string) {
  const store = await requirePublishedStoreByHost(rawHostname);
  const [album] = await db
    .select({
      id: albums.id,
      title: albums.title,
      description: albums.description,
      priceCents: albums.priceCents,
    })
    .from(albums)
    .where(
      and(eq(albums.id, albumId), eq(albums.storeId, store.id), eq(albums.status, "published")),
    )
    .limit(1);

  if (!album) {
    throw new AppError({ statusCode: 404, code: "ALBUM_NOT_FOUND", message: "Album not found." });
  }

  const sales = await getStoreSalesStatus(store.id);
  return { album, photos: await publicPhotos(store.id, album.id), purchasesEnabled: sales.enabled };
}
