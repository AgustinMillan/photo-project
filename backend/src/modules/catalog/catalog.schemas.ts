import { z } from "zod";

const price = z.number().int().positive().max(100_000_000).nullable();
const status = z.enum(["draft", "published", "archived"]);

export const createAlbumSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
  priceCents: price.optional(),
  status: z.enum(["draft", "published"]).optional(),
});
export type CreateAlbumInput = z.infer<typeof createAlbumSchema>;

export const updateAlbumSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000),
    priceCents: price,
    status: z.enum(["draft", "published"]),
    sortOrder: z.number().int().min(0).max(1_000_000),
    coverPhotoId: z.string().uuid().nullable(),
  })
  .partial();
export type UpdateAlbumInput = z.infer<typeof updateAlbumSchema>;

export const removeAlbumQuerySchema = z.object({ mode: z.enum(["release", "archive"]) });

export const albumIdParamsSchema = z.object({
  storeId: z.string().uuid(),
  albumId: z.string().uuid(),
});

export const photoIdParamsSchema = z.object({
  storeId: z.string().uuid(),
  photoId: z.string().uuid(),
});

export const listPhotosQuerySchema = z.object({
  albumId: z.string().uuid().optional(),
  unassigned: z.enum(["1", "true"]).optional(),
});

export const uploadPhotoQuerySchema = z.object({
  albumId: z.string().uuid().optional(),
  priceCents: z.coerce.number().int().positive().max(100_000_000).optional(),
  status: z.enum(["draft", "published"]).optional(),
});

export const updatePhotoSchema = z
  .object({
    title: z.string().trim().max(120),
    priceCents: price,
    status,
    albumId: z.string().uuid().nullable(),
    sortOrder: z.number().int().min(0).max(1_000_000),
  })
  .partial();
export type UpdatePhotoInput = z.infer<typeof updatePhotoSchema>;

export const bulkUpdatePhotosSchema = z
  .object({
    photoIds: z.array(z.string().uuid()).min(1).max(500),
    status: status.optional(),
    priceCents: price.optional(),
  })
  .refine((value) => value.status !== undefined || value.priceCents !== undefined, {
    message: "Nothing to update.",
  });
export type BulkUpdatePhotosInput = z.infer<typeof bulkUpdatePhotosSchema>;

export const mediaParamsSchema = z.object({
  assetId: z.string().uuid(),
  variant: z.enum(["thumb.webp", "preview.webp", "cover.webp"]),
});
