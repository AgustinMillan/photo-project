import { z } from "zod";
import { STOREFRONT_SECTION_KEYS } from "../../db/schema/index.js";

const text = (max: number) => z.string().trim().max(max);

export const updateStorefrontSchema = z.object({
  displayName: text(120).min(1),
  tagline: text(200),
  bio: text(4000),
  contactEmail: z.union([z.literal(""), z.string().trim().toLowerCase().email().max(254)]),
  phone: text(40),
  instagram: text(60).regex(/^@?[A-Za-z0-9._]*$/, "Invalid Instagram handle"),
  website: z.union([z.literal(""), z.string().trim().url().max(300)]),
  coverPhotoId: z.string().uuid().nullable().optional(),
  paymentInstructions: text(2000),
  watermarkText: text(60),
  sections: z
    .array(z.object({ key: z.enum(STOREFRONT_SECTION_KEYS), enabled: z.boolean() }))
    .length(STOREFRONT_SECTION_KEYS.length),
});

export type UpdateStorefrontInput = z.infer<typeof updateStorefrontSchema>;

export const albumParamsSchema = z.object({ albumId: z.string().uuid() });
