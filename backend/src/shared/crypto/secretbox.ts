import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "../../config/env.js";

/**
 * AES-256-GCM for secrets stored in the database (payment provider tokens).
 * Format: v1.<iv>.<tag>.<ciphertext>, all base64url.
 */
function key(): Buffer {
  if (env.TOKEN_ENCRYPTION_KEY) {
    const decoded = Buffer.from(env.TOKEN_ENCRYPTION_KEY, "base64");
    if (decoded.length !== 32) {
      throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes encoded in base64.");
    }
    return decoded;
  }
  if (env.NODE_ENV === "production") {
    throw new Error("TOKEN_ENCRYPTION_KEY is required in production.");
  }
  // Development and tests only.
  return createHash("sha256").update(`dev-secretbox:${env.JWT_ACCESS_SECRET}`).digest();
}

export function seal(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), data]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

export function open(sealed: string): string {
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Unsupported sealed secret.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(data, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
