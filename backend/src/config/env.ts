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
  // Base URL registered in the Mercado Pago app for OAuth callback and webhooks.
  // Defaults to APP_URL; set it to keep a previous domain while migrating.
  MP_PUBLIC_BASE_URL: z.string().url().optional(),
  // Optional: access token of the platform's own Mercado Pago account. When
  // empty, it is obtained with the app's client credentials.
  MP_PLATFORM_ACCESS_TOKEN: z.string().optional(),
  // Days of access kept after a missed monthly charge before the account
  // expires (Mercado Pago retries failed charges for a few days).
  // Showcase stores (comma-separated slugs): fully browsable, no real orders.
  DEMO_STORE_SLUGS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((slug) => slug.trim().toLowerCase())
        .filter(Boolean),
    ),
  BILLING_GRACE_DAYS: z.coerce.number().int().min(0).default(5),
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
  TRIAL_DURATION_DAYS: z.coerce.number().int().positive().default(30),
  SMTP_HOST: z.string().min(1).default("localhost"),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
  SMTP_FROM: z.string().min(1).default("no-reply@photo-platform.local"),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  // "log" writes outgoing emails to the application log instead of sending
  // them. Only meant as a stopgap until a transactional email provider exists.
  EMAIL_TRANSPORT: z.enum(["smtp", "log"]).default("smtp"),
  // Private media storage (originals and derivatives). Must not be web-served.
  MEDIA_ROOT: z.string().min(1).default("./var/media"),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(200).default(30),
  // Mercado Pago marketplace application (OAuth). Empty = integration disabled.
  MP_CLIENT_ID: z.string().default(""),
  MP_CLIENT_SECRET: z.string().default(""),
  MP_WEBHOOK_SECRET: z.string().default(""),
  MP_USE_PKCE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  MP_API_BASE: z.string().url().default("https://api.mercadopago.com"),
  MP_AUTH_BASE: z.string().url().default("https://auth.mercadopago.com"),
  // Platform commission on each Mercado Pago sale, in percent (0 = disabled).
  PLATFORM_FEE_PERCENT: z.coerce.number().min(0).max(50).default(0),
  // 32-byte key (base64) used to encrypt stored payment tokens.
  TOKEN_ENCRYPTION_KEY: z.string().default(""),
  // Comma-separated emails with access to the platform admin dashboard.
  PLATFORM_ADMIN_EMAILS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
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
