import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError, createApiClient } from "../src/lib/api.ts";
import { daysUntil, slugify, storeUrl } from "../src/lib/format.ts";
import { resolveTenantSlug } from "../src/lib/tenant.ts";
import {
  validateEmail,
  validatePassword,
  validateSlug,
} from "../src/lib/validation.ts";

function json(status: number, body: unknown): Response {
  return new Response(body === null ? null : JSON.stringify(body), { status });
}

describe("validation", () => {
  it("validates email", () => {
    assert.equal(validateEmail("a@b.co"), null);
    assert.notEqual(validateEmail("nope"), null);
    assert.notEqual(validateEmail(" "), null);
  });
  it("validates password length", () => {
    assert.notEqual(validatePassword("short"), null);
    assert.equal(validatePassword("a-long-enough-pass"), null);
  });
  it("validates slug", () => {
    assert.equal(validateSlug("mi-estudio"), null);
    assert.notEqual(validateSlug("ab"), null);
    assert.notEqual(validateSlug("-bad"), null);
    assert.notEqual(validateSlug("bad-"), null);
    assert.notEqual(validateSlug("a--b"), null);
    assert.notEqual(validateSlug("Bad_Slug"), null);
  });
});

describe("format", () => {
  it("slugifies with accents", () => {
    assert.equal(slugify("Estudio Fotográfico Ñandú!"), "estudio-fotografico-nandu");
    assert.equal(slugify("  ---  "), "");
  });
  it("counts days until", () => {
    const now = new Date("2026-11-18T00:00:00Z");
    assert.equal(daysUntil("2026-11-25T00:00:00Z", now), 7);
    assert.equal(daysUntil(null, now), null);
    assert.equal(daysUntil("garbage", now), null);
  });
  it("builds store url keeping port", () => {
    assert.equal(
      storeUrl("x.localhost", { protocol: "http:", port: "5173" }),
      "http://x.localhost:5173",
    );
    assert.equal(storeUrl(null, { protocol: "https:", port: "" }), null);
  });
});

describe("tenant", () => {
  it("resolves tenant slug", () => {
    assert.equal(resolveTenantSlug("foto.localhost", "localhost"), "foto");
    assert.equal(resolveTenantSlug("localhost", "localhost"), null);
    assert.equal(resolveTenantSlug("www.example.com", "example.com"), null);
    assert.equal(resolveTenantSlug("a.b.example.com", "example.com"), null);
    assert.equal(resolveTenantSlug("other.com", "example.com"), null);
  });
});

describe("api client", () => {
  it("parses error envelope", async () => {
    const api = createApiClient({
      fetchImpl: async () =>
        json(409, { error: { code: "SLUG_TAKEN", message: "taken", requestId: "r1" } }),
    });
    await assert.rejects(api.post("/x", {}, { auth: false }), (e: unknown) => {
      assert.ok(e instanceof ApiError);
      assert.equal(e.code, "SLUG_TAKEN");
      assert.equal(e.status, 409);
      return true;
    });
  });

  it("refreshes once on 401 and retries", async () => {
    const calls: string[] = [];
    const api = createApiClient({
      fetchImpl: async (url, init) => {
        const path = String(url);
        const auth = (init?.headers as Record<string, string>)?.Authorization ?? "";
        calls.push(`${path}|${auth}`);
        if (path.endsWith("/auth/refresh")) {
          return json(200, { accessToken: "new", tokenType: "Bearer", expiresIn: 900, user: {} });
        }
        return auth === "Bearer new" ? json(200, { ok: true }) : json(401, { error: { code: "UNAUTHORIZED" } });
      },
    });
    api.setAccessToken("old");
    const result = await api.get<{ ok: boolean }>("/stores");
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(calls, [
      "/api/v1/stores|Bearer old",
      "/api/v1/auth/refresh|",
      "/api/v1/stores|Bearer new",
    ]);
  });

  it("dedupes concurrent refreshes", async () => {
    let refreshes = 0;
    const api = createApiClient({
      fetchImpl: async (url, init) => {
        const path = String(url);
        const auth = (init?.headers as Record<string, string>)?.Authorization ?? "";
        if (path.endsWith("/auth/refresh")) {
          refreshes++;
          await new Promise((r) => setTimeout(r, 10));
          return json(200, { accessToken: "new", tokenType: "Bearer", expiresIn: 900, user: {} });
        }
        return auth === "Bearer new" ? json(200, {}) : json(401, {});
      },
    });
    await Promise.all([api.get("/a"), api.get("/b"), api.get("/c")]);
    assert.equal(refreshes, 1);
  });

  it("signals session lost when refresh fails", async () => {
    let lost = 0;
    const api = createApiClient({ fetchImpl: async () => json(401, { error: { code: "UNAUTHORIZED" } }) });
    api.onSessionLost(() => lost++);
    await assert.rejects(api.get("/stores"));
    assert.equal(lost, 1);
  });

  it("maps network failure", async () => {
    const api = createApiClient({
      fetchImpl: async () => {
        throw new TypeError("fail");
      },
    });
    await assert.rejects(api.get("/x", { auth: false }), (e: unknown) => {
      assert.ok(e instanceof ApiError);
      assert.equal(e.code, "NETWORK_ERROR");
      return true;
    });
  });
});
