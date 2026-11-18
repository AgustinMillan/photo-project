import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createApiClient } from "../src/lib/api.ts";
import { centsToInput, formatMoney, parsePesos } from "../src/lib/money.ts";

describe("money", () => {
  it("parses Argentine-formatted pesos into cents", () => {
    assert.equal(parsePesos("12.500"), 1_250_000);
    assert.equal(parsePesos("$ 1.234,50"), 123_450);
    assert.equal(parsePesos("800"), 80_000);
    assert.equal(parsePesos(""), null);
    assert.ok(Number.isNaN(parsePesos("abc")));
    assert.ok(Number.isNaN(parsePesos("0")));
  });

  it("round-trips cents to the edit field", () => {
    assert.equal(centsToInput(123_450), "1234,5");
    assert.equal(centsToInput(null), "");
  });

  it("formats whole pesos without decimals", () => {
    assert.match(formatMoney(1_250_000), /12\.500/);
    assert.equal(formatMoney(null), "—");
  });
});

describe("api uploads", () => {
  it("sends multipart bodies without forcing a JSON content type", async () => {
    let seen: RequestInit | undefined;
    const client = createApiClient({
      fetchImpl: async (_url, init) => {
        seen = init;
        return new Response(JSON.stringify({ ok: true }), { status: 201 });
      },
    });
    await client.upload("/stores/s/photos", new File(["x"], "a.jpg", { type: "image/jpeg" }));
    assert.ok(seen?.body instanceof FormData);
    assert.equal(((seen?.headers ?? {}) as Record<string, string>)["Content-Type"], undefined);
  });
});
