import { describe, expect, it } from "vitest";
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  verifyPassword,
} from "../../src/shared/auth/password.js";

describe("password hashing", () => {
  it("hashes with Argon2id and verifies the original password", async () => {
    const password = "CorrectHorseBatteryStaple!";
    const passwordHash = await hashPassword(password);

    expect(passwordHash).not.toBe(password);
    expect(passwordHash.startsWith("$argon2id$")).toBe(true);
    await expect(verifyPassword(passwordHash, password)).resolves.toBe(true);
    await expect(verifyPassword(passwordHash, "wrong-password")).resolves.toBe(false);
  });

  it("uses a valid dummy hash for missing accounts", async () => {
    await expect(verifyPassword(DUMMY_PASSWORD_HASH, "not-a-real-password")).resolves.toBe(true);
  });
});
