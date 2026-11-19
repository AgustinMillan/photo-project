import { z } from "zod";

const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9_-]{3,30}$/, "Use 3 to 30 letters, numbers, - or _");

export const createCouponSchema = z.object({
  code,
  percentOff: z.number().int().min(1).max(90),
  appliesTo: z.enum(["all", "photos", "albums"]).default("all"),
  maxUses: z.number().int().positive().max(100_000).nullable().default(null),
  endsAt: z.coerce.date().nullable().default(null),
  showInStore: z.boolean().default(false),
});
export type CreateCouponInput = z.infer<typeof createCouponSchema>;

export const updateCouponSchema = z
  .object({
    percentOff: z.number().int().min(1).max(90),
    appliesTo: z.enum(["all", "photos", "albums"]),
    maxUses: z.number().int().positive().max(100_000).nullable(),
    endsAt: z.coerce.date().nullable(),
    active: z.boolean(),
    showInStore: z.boolean(),
  })
  .partial();
export type UpdateCouponInput = z.infer<typeof updateCouponSchema>;

export const couponParamsSchema = z.object({
  storeId: z.string().uuid(),
  couponId: z.string().uuid(),
});

export const checkCouponSchema = z.object({
  code: z.string().trim().min(1).max(40),
  items: z
    .array(z.object({ type: z.enum(["photo", "album"]), id: z.string().uuid() }))
    .min(1)
    .max(300),
});
