import { describe, expect, it } from "vitest";
import { generateOpaqueToken, hashToken } from "../../src/shared/auth/tokens.js";

describe("opaque tokens", () => {
  it("generates URL-safe tokens with enough entropy", () => {
    const first = generateOpaqueToken();
    const second = generateOpaqueToken();

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);
  });

  it("hashes tokens deterministically without storing the raw value", () => {
    const token = generateOpaqueToken();
    const hash = hashToken(token);

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toBe(token);
    expect(hashToken(token)).toBe(hash);
    expect(hashToken(generateOpaqueToken())).not.toBe(hash);
  });
});
