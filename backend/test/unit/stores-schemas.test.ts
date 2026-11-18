import { describe, expect, it } from "vitest";
import { isReservedStoreSlug } from "../../src/modules/stores/stores.constants.js";
import {
  createStoreInvitationSchema,
  createStoreSchema,
  storeSlugSchema,
  updateStoreMemberSchema,
} from "../../src/modules/stores/stores.schemas.js";

describe("store slug validation", () => {
  it("normalizes valid slugs", () => {
    expect(storeSlugSchema.parse("  Studio-One  ")).toBe("studio-one");
    expect(storeSlugSchema.parse("photo123")).toBe("photo123");
  });

  it.each([
    "ab",
    "-leading",
    "trailing-",
    "two--hyphens",
    "with space",
    "with_underscore",
    "ñandú",
  ])("rejects %s", (slug) => {
    expect(() => storeSlugSchema.parse(slug)).toThrow();
  });

  it("rejects reserved slugs case-insensitively", () => {
    expect(isReservedStoreSlug("admin")).toBe(true);
    expect(isReservedStoreSlug("WWW")).toBe(true);
    expect(isReservedStoreSlug("studio")).toBe(false);
  });

  it("requires a name and slug to create a store", () => {
    expect(() => createStoreSchema.parse({ name: "", slug: "valid-slug" })).toThrow();
    expect(createStoreSchema.parse({ name: "My Store", slug: "My-Store" })).toEqual({
      name: "My Store",
      slug: "my-store",
    });
  });

  it("normalizes an optional trial plan code", () => {
    expect(
      createStoreSchema.parse({
        name: "My Store",
        slug: "My-Store",
        planCode: " Business ",
      }),
    ).toEqual({
      name: "My Store",
      slug: "my-store",
      planCode: "business",
    });
    expect(() =>
      createStoreSchema.parse({ name: "My Store", slug: "my-store", planCode: "bad code" }),
    ).toThrow();
  });
});

describe("store membership and invitation validation", () => {
  it("does not allow assigning OWNER through invitations or member updates", () => {
    expect(() =>
      createStoreInvitationSchema.parse({ email: "person@example.com", role: "OWNER" }),
    ).toThrow();
    expect(() => updateStoreMemberSchema.parse({ role: "OWNER" })).toThrow();
  });

  it("normalizes invitation emails and accepts assignable roles", () => {
    expect(
      createStoreInvitationSchema.parse({ email: " Person@Example.com ", role: "EDITOR" }),
    ).toEqual({ email: "person@example.com", role: "EDITOR" });
  });
});
