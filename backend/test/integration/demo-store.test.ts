import { randomUUID } from "node:crypto";
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

async function publishedStore(slug: string) {
  const email = `${slug}@example.com`;
  await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: { email, password: PASSWORD, displayName: "X" },
  });
  const token = testEmailOutbox.at(-1)?.text.match(/token=([A-Za-z0-9_-]+)/)?.[1];
  await app.inject({ method: "POST", url: "/api/v1/auth/verify-email", payload: { token } });
  const login = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, password: PASSWORD },
  });
  const auth = { authorization: `Bearer ${login.json().accessToken}` };
  await app.inject({
    method: "POST",
    url: "/api/v1/accounts",
    headers: auth,
    payload: { name: slug },
  });
  const store = await app.inject({
    method: "POST",
    url: "/api/v1/stores",
    headers: auth,
    payload: { name: slug, slug },
  });
  const storeId = store.json().store.id as string;
  const publish = await app.inject({
    method: "POST",
    url: `/api/v1/stores/${storeId}/storefront/publish`,
    headers: auth,
  });
  expect(publish.statusCode).toBe(200);
  return { host: `${slug}.localhost`, storeId, auth };
}

describe("showcase store", () => {
  it("is marked as demo and does not take orders", async () => {
    const { host } = await publishedStore("ejemplo");
    const storefront = await app.inject({
      method: "GET",
      url: "/api/v1/public/storefront",
      headers: { host },
    });
    expect(storefront.json().store.isDemo).toBe(true);

    const order = await app.inject({
      method: "POST",
      url: "/api/v1/public/orders",
      headers: { host },
      payload: {
        customerName: "Cliente",
        customerEmail: "cliente@example.com",
        items: [{ type: "photo", id: randomUUID() }],
      },
    });
    expect(order.statusCode).toBe(409);
    expect(order.json().error.code).toBe("STORE_IS_DEMO");
  });

  it("leaves regular stores unchanged", async () => {
    const { host } = await publishedStore("normal");
    const storefront = await app.inject({
      method: "GET",
      url: "/api/v1/public/storefront",
      headers: { host },
    });
    expect(storefront.json().store.isDemo).toBe(false);
  });

  it("reports onboarding progress for the first-steps guide", async () => {
    const { storeId, auth } = await publishedStore("nuevo");
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/stores/${storeId}/onboarding`,
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().progress).toMatchObject({
      profile: false,
      photos: false,
      payments: false,
      published: true,
      firstVisit: false,
      firstSale: false,
      photoCount: 0,
      mercadoPago: false,
    });
  });
});
