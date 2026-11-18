import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  CORS_ORIGIN: z.string().min(1).default("http://localhost:5173"),
  APP_URL: z.string().url().default("http://localhost:5173"),
  PLATFORM_DOMAIN: z.string().min(1).default("localhost"),
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must have at least 32 characters"),
  JWT_ISSUER: z.string().min(1).default("photo-platform"),
  JWT_AUDIENCE: z.string().min(1).default("photo-platform-api"),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  REFRESH_COOKIE_NAME: z.string().min(1).default("refresh_token"),
  EMAIL_VERIFICATION_TTL_HOURS: z.coerce.number().int().positive().default(24),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(60),
  STORE_INVITATION_TTL_DAYS: z.coerce.number().int().positive().default(7),
  TRIAL_PLAN_CODE: z
    .string()
    .min(1)
    .default("base")
    .transform((value) => value.trim().toLowerCase()),
  TRIAL_DURATION_DAYS: z.coerce.number().int().positive().default(14),
  SMTP_HOST: z.string().min(1).default("localhost"),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
  SMTP_FROM: z.string().min(1).default("no-reply@photo-platform.local"),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  const details = result.error.issues
    .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
    .join("\n");

  // Never print secret values; only the failing keys and validation messages.
  console.error(`Invalid environment configuration:\n${details}`);
  process.exit(1);
}

export const env = result.data;
export type Env = typeof env;
