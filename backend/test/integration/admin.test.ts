import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { clearTestEmailOutbox, testEmailOutbox } from "../../src/modules/auth/auth.email.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for integration tests.");

const client = postgres(databaseUrl, { max: 1 });
const PASSWORD = "CorrectHorseBatteryStaple!";
let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});
beforeEach(async () => {
  await client`truncate table users, audit_logs cascade`;
  clearTestEmailOutbox();
});
afterAll(async () => {
  await app.close();
  await client.end({ timeout: 5 });
});

async function login(email: string, store?: string) {
  await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: { email, password: PASSWORD },
  });
  const message = [...testEmailOutbox].reverse().find((m) => m.to === email.toLowerCase());
  const token = message?.text.match(/token=([A-Za-z0-9_-]+)/)?.[1];
  await app.inject({ method: "POST", url: "/api/v1/auth/verify-email", payload: { token } });
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, password: PASSWORD },
  });
  const access = response.json().accessToken as string;
  if (store) {
    const headers = { authorization: `Bearer ${access}` };
    await app.inject({
      method: "POST",
      url: "/api/v1/accounts",
      headers,
      payload: { name: store },
    });
    await app.inject({
      method: "POST",
      url: "/api/v1/stores",
      headers,
      payload: { name: store, slug: store },
    });
  }
  return { authorization: `Bearer ${access}` };
}

describe("platform admin dashboard", () => {
  it("is invisible to anyone who is not a platform admin", async () => {
    const photographer = await login("photographer@example.com", "foto-uno");
    expect(
      (await app.inject({ method: "GET", url: "/api/v1/admin/me", headers: photographer })).json(),
    ).toEqual({
      admin: false,
    });
    for (const url of ["/api/v1/admin/overview", "/api/v1/admin/accounts"]) {
      expect((await app.inject({ method: "GET", url, headers: photographer })).statusCode).toBe(
        404,
      );
    }
    const action = await app.inject({
      method: "POST",
      url: "/api/v1/admin/actions",
      headers: photographer,
      payload: { action: "pilot_start", email: "photographer@example.com" },
    });
    expect(action.statusCode).toBe(404);
  });

  it("shows platform metrics, accounts and runs account actions", async () => {
    await login("photographer@example.com", "foto-uno");
    await login("second@example.com", "foto-dos");
    const admin = await login("Founder@example.com");

    expect(
      (await app.inject({ method: "GET", url: "/api/v1/admin/me", headers: admin })).json(),
    ).toEqual({ admin: true });

    const overview = (
      await app.inject({ method: "GET", url: "/api/v1/admin/overview?days=14", headers: admin })
    ).json();
    expect(overview.totals).toMatchObject({
      users: 3,
      accounts: 2,
      stores: 2,
      orders: 0,
      gmvCents: 0,
    });
    expect(overview.series).toHaveLength(14);
    expect(overview.series.at(-1).signups).toBe(3);
    expect(overview.subscriptions).toEqual([{ status: "trial", plan: "base", count: 2 }]);

    const action = await app.inject({
      method: "POST",
      url: "/api/v1/admin/actions",
      headers: admin,
      payload: { action: "pilot_start", email: "second@example.com", note: "facultad" },
    });
    expect(action.json()).toEqual({ ok: true });

    const accounts = (
      await app.inject({ method: "GET", url: "/api/v1/admin/accounts", headers: admin })
    ).json().accounts as Array<{
      ownerEmail: string;
      status: string;
      plan: string;
      storeSlug: string;
    }>;
    expect(accounts.find((a) => a.ownerEmail === "second@example.com")).toMatchObject({
      status: "pilot",
      plan: "business",
      storeSlug: "foto-dos",
    });

    const invalid = await app.inject({
      method: "POST",
      url: "/api/v1/admin/actions",
      headers: admin,
      payload: { action: "pilot_end", email: "photographer@example.com" },
    });
    expect(invalid.statusCode).toBe(409);
    expect(invalid.json().error.code).toBe("NOT_A_PILOT");
  });
});
