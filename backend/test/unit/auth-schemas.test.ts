import { describe, expect, it } from "vitest";
import { loginSchema, registerSchema } from "../../src/modules/auth/auth.schemas.js";

describe("auth schemas", () => {
  it("normalizes emails and trims display names", () => {
    const input = registerSchema.parse({
      email: "  User@Example.COM ",
      password: "CorrectHorseBatteryStaple!",
      displayName: "  Test User  ",
    });

    expect(input.email).toBe("user@example.com");
    expect(input.displayName).toBe("Test User");
  });

  it("rejects short registration passwords", () => {
    const result = registerSchema.safeParse({
      email: "user@example.com",
      password: "too-short",
    });

    expect(result.success).toBe(false);
  });

  it("accepts any non-empty password on login so legacy passwords still work", () => {
    const result = loginSchema.safeParse({
      email: "user@example.com",
      password: "short",
    });

    expect(result.success).toBe(true);
  });
});
