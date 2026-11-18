import { z } from "zod";
import { emailSchema } from "../../shared/validation/email.js";

export const storeSlugSchema = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .pipe(
    z
      .string()
      .min(3, "Slug must have at least 3 characters.")
      .max(63, "Slug must have at most 63 characters.")
      .regex(
        /^[a-z0-9][a-z0-9-]*[a-z0-9]$/,
        "Slug must contain only lowercase letters, numbers and hyphens, and cannot start or end with a hyphen.",
      )
      .refine((value) => !value.includes("--"), "Slug cannot contain consecutive hyphens."),
  );

export const planCodeSchema = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .pipe(
    z
      .string()
      .min(1)
      .max(63)
      .regex(/^[a-z0-9][a-z0-9-]*$/, "Plan code has an invalid format."),
  );

export const createStoreSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: storeSlugSchema,
  // Optional only while the trial subscription is being created. It lets
  // onboarding choose the trial plan without introducing a billing gateway.
  planCode: planCodeSchema.optional(),
});

export const updateStoreSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    slug: storeSlugSchema.optional(),
  })
  .refine((input) => input.name !== undefined || input.slug !== undefined, {
    message: "At least one field must be provided.",
  });

export const storeParamsSchema = z.object({
  storeId: z.string().uuid(),
});

export const storeMemberParamsSchema = z.object({
  storeId: z.string().uuid(),
  userId: z.string().uuid(),
});

export const storeInvitationParamsSchema = z.object({
  storeId: z.string().uuid(),
  invitationId: z.string().uuid(),
});

export const assignableStoreRoleSchema = z.enum(["ADMIN", "PHOTOGRAPHER", "EDITOR"]);

export const updateStoreMemberSchema = z.object({
  role: assignableStoreRoleSchema,
});

export const createStoreInvitationSchema = z.object({
  email: emailSchema,
  role: assignableStoreRoleSchema,
});

export const acceptStoreInvitationSchema = z.object({
  token: z.string().min(20).max(512),
});

export type CreateStoreInput = z.infer<typeof createStoreSchema>;
export type UpdateStoreInput = z.infer<typeof updateStoreSchema>;
export type UpdateStoreMemberInput = z.infer<typeof updateStoreMemberSchema>;
export type CreateStoreInvitationInput = z.infer<typeof createStoreInvitationSchema>;
export type AcceptStoreInvitationInput = z.infer<typeof acceptStoreInvitationSchema>;
