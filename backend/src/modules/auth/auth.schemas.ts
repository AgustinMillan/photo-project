import { z } from "zod";
import { emailSchema } from "../../shared/validation/email.js";

export { emailSchema };

export const passwordSchema = z
  .string()
  .min(12, "Password must have at least 12 characters.")
  .max(128, "Password must have at most 128 characters.");

export const tokenSchema = z.string().min(20).max(512);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(120).optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export const verifyEmailSchema = z.object({
  token: tokenSchema,
});

export const resendVerificationSchema = z.object({
  email: emailSchema,
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: tokenSchema,
  newPassword: passwordSchema,
});

export const logoutSchema = z.object({
  allDevices: z.boolean().optional().default(false),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
