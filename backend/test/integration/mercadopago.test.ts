import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/app.js";
import { clearTestEmailOutbox, testEmailOutbox } from "../../src/modules/auth/auth.email.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for integration tests.");

const client = postgres(databaseUrl, { max: 1 });
const PASSWORD = "CorrectHorseBatteryStaple!";
const SELLER_TOKEN = "APP_USR-seller-token";
const SELLER_ID = 777;
let app: FastifyInstance;

// ---------------------------------------------------------------------------
// Fake Mercado Pago API
// ---------------------------------------------------------------------------

type FakePayment = {
  id: number;
  status: string;
  external_reference: string;
  transaction_amount: number;
  currency_id: string;
  collector_id: number;
};
const mp = {
  preferences: [] as Array<{ auth: string | null; body: Record<string, unknown> }>,
  payments: new Map<string, FakePayment>(),
  tokenRequests: [] as Array<Record<string, unknown>>,
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
  );
  const auth = new Headers(init?.headers).get("authorization");
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  if (url.origin !== "https://mp.test") throw new Error(`Unexpected fetch to ${url}`);

  if (url.pathname === "/oauth/token") {
    mp.tokenRequests.push(body);
    if (body.code !== "good-code" && body.grant_type !== "refresh_token") {
      return json(400, { error: "invalid_grant" });
    }
    return json(200, {
      access_token: SELLER_TOKEN,
      refresh_token: "TG-refresh",
      public_key: "APP_USR-public",
      user_id: SELLER_ID,
      expires_in: 15_552_000,
      live_mode: false,
    });
  }
  if (auth !== `Bearer ${SELLER_TOKEN}`) return json(401, { message: "unauthorized" });
  if (url.pathname === "/checkout/preferences" && init?.method === "POST") {
    mp.preferences.push({ auth, body });
    return json(201, {
      id: `pref-${mp.preferences.length}`,
      init_point: "https://mp.test/checkout",
    });
  }
  if (url.pathname === "/v1/payments/search") {
    const reference = url.searchParams.get("external_reference");
    return json(200, {
      results: [...mp.payments.values()].filter((p) => p.external_reference === reference),
    });
  }
  const match = url.pathname.match(/^\/v1\/payments\/(\d+)$/);
  if (match?.[1]) {
    const payment = mp.payments.get(match[1]);
    return payment ? json(200, payment) : json(404, { message: "not found" });
  }
  return json(404, { message: "no route" });
}

beforeAll(async () => {
  vi.stubGlobal("fetch", fakeFetch);
  app = await buildApp();
});

beforeEach(async () => {
  await client`truncate table users, audit_logs cascade`;
  clearTestEmailOutbox();
  mp.preferences.length = 0;
  mp.payments.clear();
  mp.tokenRequests.length = 0;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await app.close();
  await client.end({ timeout: 5 });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

type Owner = { token: string; storeId: string; host: string };

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function createOwner(email: string, slug: string): Promise<Owner> {
  await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: { email, password: PASSWORD, displayName: "Owner" },
  });
  const message = [...testEmailOutbox].reverse().find((m) => m.to === email);
  const verifyToken = message?.text.match(/token=([A-Za-z0-9_-]+)/)?.[1];
  await app.inject({
    method: "POST",
    url: "/api/v1/auth/verify-email",
    payload: { token: verifyToken },
  });
  const login = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, password: PASSWORD },
  });
  const token = login.json().accessToken as string;
  await app.inject({
    method: "POST",
    url: "/api/v1/accounts",
    headers: auth(token),
    payload: { name: slug },
  });
  const store = await app.inject({
    method: "POST",
    url: "/api/v1/stores",
    headers: auth(token),
    payload: { name: slug, slug },
  });
  return { token, storeId: store.json().store.id, host: `${slug}.localhost` };
}

async function publishWithPhoto(owner: Owner, paymentInstructions = "") {
  await app.inject({
    method: "PUT",
    url: `/api/v1/stores/${owner.storeId}/storefront`,
    headers: auth(owner.token),
    payload: {
      displayName: "Estudio",
      tagline: "",
      bio: "",
      contactEmail: "",
      phone: "",
      instagram: "",
      website: "",
      coverPhotoId: null,
      paymentInstructions,
      watermarkText: "X",
      sections: ["hero", "albums", "about", "contact"].map((key) => ({ key, enabled: true })),
    },
  });
  await app.inject({
    method: "POST",
    url: `/api/v1/stores/${owner.storeId}/storefront/publish`,
    headers: auth(owner.token),
  });
  const buffer = await sharp({
    create: { width: 800, height: 600, channels: 3, background: "#123456" },
  })
    .jpeg()
    .toBuffer();
  const boundary = "----mp-test";
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
    ),
    buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const upload = await app.inject({
    method: "POST",
    url: `/api/v1/stores/${owner.storeId}/photos?priceCents=250000&status=published`,
    headers: { ...auth(owner.token), "content-type": `multipart/form-data; boundary=${boundary}` },
    payload,
  });
  return upload.json().photo.id as string;
}

async function connect(owner: Owner) {
  const start = await app.inject({
    method: "POST",
    url: `/api/v1/stores/${owner.storeId}/payments/mercadopago/connect`,
    headers: auth(owner.token),
  });
  expect(start.statusCode).toBe(200);
  const url = new URL(start.json().url);
  const state = url.searchParams.get("state") ?? "";
  return app.inject({
    method: "GET",
    url: `/api/v1/payments/mercadopago/callback?code=good-code&state=${encodeURIComponent(state)}`,
  });
}

async function mpOrder(owner: Owner, photoId: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/public/orders",
    headers: { host: owner.host },
    payload: {
      customerName: "Cliente MP",
      customerEmail: "cliente@example.com",
      paymentMethod: "mercadopago",
      items: [{ type: "photo", id: photoId }],
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json().order as { orderId: string; accessToken: string; totalCents: number };
}

function signedWebhook(storeId: string, paymentId: string, secret = "test-webhook-secret") {
  const ts = String(Date.now());
  const requestId = `req-${paymentId}`;
  const v1 = createHmac("sha256", secret)
    .update(`id:${paymentId};request-id:${requestId};ts:${ts};`)
    .digest("hex");
  return app.inject({
    method: "POST",
    url: `/api/v1/payments/mercadopago/webhook?store=${storeId}&data.id=${paymentId}&type=payment`,
    headers: { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": requestId },
    payload: { type: "payment", data: { id: paymentId } },
  });
}

// ---------------------------------------------------------------------------

describe("Mercado Pago marketplace", () => {
  it("connects a photographer's account through OAuth and stores tokens encrypted", async () => {
    const owner = await createOwner("connect@example.com", "connect-studio");
    const callback = await connect(owner);
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toContain("/app/payments?mp=connected");
    expect(mp.tokenRequests[0]).toMatchObject({
      grant_type: "authorization_code",
      code: "good-code",
    });

    const [row] =
      await client`select provider_user_id, access_token_enc from store_payment_accounts`;
    expect(row?.provider_user_id).toBe(String(SELLER_ID));
    expect(row?.access_token_enc).not.toContain(SELLER_TOKEN);

    const status = await app.inject({
      method: "GET",
      url: `/api/v1/stores/${owner.storeId}/payments/mercadopago`,
      headers: auth(owner.token),
    });
    expect(status.json()).toMatchObject({
      available: true,
      connected: true,
      platformFeePercent: 0,
    });
  });

  it("rejects a forged OAuth state", async () => {
    const callback = await app.inject({
      method: "GET",
      url: "/api/v1/payments/mercadopago/callback?code=good-code&state=forged.state",
    });
    expect(callback.headers.location).toContain("mp=error");
    const rows = await client`select count(*)::int as n from store_payment_accounts`;
    expect(rows[0]?.n).toBe(0);
  });

  it("creates a checkout with the seller's credentials and no fee while it is 0%", async () => {
    const owner = await createOwner("pref@example.com", "pref-studio");
    const photoId = await publishWithPhoto(owner);
    await connect(owner);

    const storefront = await app.inject({
      method: "GET",
      url: "/api/v1/public/storefront",
      headers: { host: owner.host },
    });
    expect(storefront.json().store.payments).toEqual({ mercadopago: true, transfer: false });

    const order = await mpOrder(owner, photoId);
    const checkout = await app.inject({
      method: "POST",
      url: `/api/v1/public/orders/${order.orderId}/mercadopago/checkout?token=${order.accessToken}`,
      headers: { host: owner.host },
    });
    expect(checkout.json().url).toBe("https://mp.test/checkout");
    const preference = mp.preferences[0]?.body as Record<string, unknown>;
    expect(preference).toMatchObject({
      external_reference: order.orderId,
      auto_return: "approved",
    });
    expect(preference).not.toHaveProperty("marketplace_fee");
    expect(String(preference.notification_url)).toContain(`store=${owner.storeId}`);
    expect((preference.items as Array<{ unit_price: number }>)[0]?.unit_price).toBe(2500);

    const transfer = await app.inject({
      method: "POST",
      url: "/api/v1/public/orders",
      headers: { host: owner.host },
      payload: {
        customerName: "Otro",
        customerEmail: "o@example.com",
        items: [{ type: "photo", id: photoId }],
      },
    });
    expect(transfer.statusCode).toBe(409);
    expect(transfer.json().error.code).toBe("PAYMENT_METHOD_UNAVAILABLE");
  });

  it("confirms the order from a signed webhook, once, and delivers the photos", async () => {
    const owner = await createOwner("hook@example.com", "hook-studio");
    const photoId = await publishWithPhoto(owner);
    await connect(owner);
    const order = await mpOrder(owner, photoId);
    clearTestEmailOutbox();

    mp.payments.set("9001", {
      id: 9001,
      status: "approved",
      external_reference: order.orderId,
      transaction_amount: 2500,
      currency_id: "ARS",
      collector_id: SELLER_ID,
    });

    expect((await signedWebhook(owner.storeId, "9001", "wrong-secret")).statusCode).toBe(401);
    const first = await signedWebhook(owner.storeId, "9001");
    expect(first.json()).toEqual({ result: "paid" });
    const again = await signedWebhook(owner.storeId, "9001");
    expect(again.statusCode).toBe(200);

    const paymentsRows = await client`select method, provider_payment_id from payments`;
    expect(paymentsRows).toEqual([{ method: "mercadopago", provider_payment_id: "mp:9001" }]);
    const view = await app.inject({
      method: "GET",
      url: `/api/v1/public/orders/${order.orderId}?token=${order.accessToken}`,
      headers: { host: owner.host },
    });
    expect(view.json().order.status).toBe("paid");
    expect(view.json().downloads).toHaveLength(1);
    expect(testEmailOutbox.filter((m) => m.subject.includes("están listas"))).toHaveLength(1);
  });

  it("ignores payments collected by another account or below the total", async () => {
    const owner = await createOwner("guard@example.com", "guard-studio");
    const photoId = await publishWithPhoto(owner);
    await connect(owner);
    const order = await mpOrder(owner, photoId);

    mp.payments.set("9100", {
      id: 9100,
      status: "approved",
      external_reference: order.orderId,
      transaction_amount: 2500,
      currency_id: "ARS",
      collector_id: 123,
    });
    expect((await signedWebhook(owner.storeId, "9100")).json()).toEqual({
      result: "other_collector",
    });

    mp.payments.set("9101", {
      id: 9101,
      status: "approved",
      external_reference: order.orderId,
      transaction_amount: 1000,
      currency_id: "ARS",
      collector_id: SELLER_ID,
    });
    expect((await signedWebhook(owner.storeId, "9101")).json()).toEqual({ result: "partial" });

    const [row] = await client`select status from orders`;
    expect(row?.status).toBe("pending_payment");
  });

  it("confirms on return from Mercado Pago even if the webhook has not arrived", async () => {
    const owner = await createOwner("sync@example.com", "sync-studio");
    const photoId = await publishWithPhoto(owner);
    await connect(owner);
    const order = await mpOrder(owner, photoId);
    mp.payments.set("9200", {
      id: 9200,
      status: "approved",
      external_reference: order.orderId,
      transaction_amount: 2500,
      currency_id: "ARS",
      collector_id: SELLER_ID,
    });

    const synced = await app.inject({
      method: "POST",
      url: `/api/v1/public/orders/${order.orderId}/mercadopago/sync?token=${order.accessToken}`,
      headers: { host: owner.host },
    });
    expect(synced.json().order.status).toBe("paid");
    expect(synced.json().downloads).toHaveLength(1);
  });

  it("keeps transfers as an option when the store publishes payment instructions", async () => {
    const owner = await createOwner("both@example.com", "both-studio");
    await publishWithPhoto(owner, "Alias: ESTUDIO");
    await connect(owner);
    const storefront = await app.inject({
      method: "GET",
      url: "/api/v1/public/storefront",
      headers: { host: owner.host },
    });
    expect(storefront.json().store.payments).toEqual({ mercadopago: true, transfer: true });
  });
});
