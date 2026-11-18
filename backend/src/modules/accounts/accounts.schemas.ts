import { z } from "zod";
import { ACCOUNT_TYPES } from "../../db/schema/index.js";
import { emailSchema } from "../../shared/validation/email.js";

export const accountTypeSchema = z.enum(ACCOUNT_TYPES);

export const createAccountSchema = z.object({
  name: z.string().trim().min(1).max(120),
  billingEmail: emailSchema.optional(),
  type: accountTypeSchema.optional(),
});

export const updateAccountSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    billingEmail: emailSchema.optional(),
    type: accountTypeSchema.optional(),
  })
  .refine(
    (input) =>
      input.name !== undefined || input.billingEmail !== undefined || input.type !== undefined,
    { message: "At least one field must be provided." },
  );

export type CreateAccountInput = z.infer<typeof createAccountSchema>;
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;
