import { env } from "../../config/env.js";

/**
 * Slugs that must not be assigned to a store because they are used by the
 * platform, its infrastructure, or common onboarding routes.
 */
export const RESERVED_STORE_SLUGS = new Set([
  "admin",
  "administrator",
  "api",
  "api-v1",
  "app",
  "assets",
  "auth",
  "billing",
  "blog",
  "cart",
  "cdn",
  "checkout",
  "contact",
  "cookies",
  "dashboard",
  "demo",
  "dev",
  "development",
  "docs",
  "download",
  "downloads",
  "favicon",
  "files",
  "ftp",
  "graphql",
  "health",
  "help",
  "images",
  "img",
  "imap",
  "internal",
  "legal",
  "localhost",
  "login",
  "logout",
  "mail",
  "mailpit",
  "media",
  "news",
  "no-reply",
  "noreply",
  "orders",
  "panel",
  "pay",
  "payments",
  "policies",
  "pop",
  "postmaster",
  "preview",
  "pricing",
  "privacy",
  "private",
  "prod",
  "production",
  "public",
  "register",
  "robots",
  "root",
  "sandbox",
  "secure",
  "security",
  "shop",
  "shopping",
  "signup",
  "sitemap",
  "smtp",
  "stage",
  "staging",
  "static",
  "status",
  "store",
  "stores",
  "subscribe",
  "subscription",
  "support",
  "system",
  "terms",
  "test",
  "testing",
  "webhooks",
  "webmaster",
  "well-known",
  "www",
  "www1",
]);

export function normalizeStoreSlug(value: string): string {
  return value.trim().toLowerCase();
}

export function isReservedStoreSlug(slug: string): boolean {
  return RESERVED_STORE_SLUGS.has(normalizeStoreSlug(slug));
}

export function buildPlatformHostname(slug: string): string {
  const domain = env.PLATFORM_DOMAIN.trim().toLowerCase().replace(/\.$/, "");
  return `${normalizeStoreSlug(slug)}.${domain}`;
}

export function normalizeHostname(hostname: string): string {
  const trimmed = hostname.trim().toLowerCase();
  const withoutPort = trimmed.includes(":") ? (trimmed.split(":")[0] ?? "") : trimmed;

  return withoutPort.replace(/\.$/, "");
}
