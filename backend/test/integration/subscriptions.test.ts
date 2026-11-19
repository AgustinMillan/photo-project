import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/app.js";
import { clearTestEmailOutbox, testEmailOutbox } from "../../src/modules/auth/auth.email.js";
import { sendTrialEndingReminders } from "../../src/modules/billing/billing.mercadopago.js";
import { resetPlatformTokenCache } from "../../src/modules/payments/mercadopago.client.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for integration tests.");

const client = postgres(databaseUrl, { max: 1 });
const PASSWORD = "CorrectHorseBatteryStaple!";
const PLATFORM_TOKEN = "APP_USR-platform-token";
let app: FastifyInstance;

// ---------------------------------------------------------------------------
// Fake Mercado Pago (platform account: preapproval + authorized payments)
// ---------------------------------------------------------------------------

type FakePreapproval = {
  id: string;
  status: string;
  init_point: string;
  external_reference: string;
  payer_email: string;
  reason: string;
  next_payment_date: string | null;
  auto_recurring: { transaction_amount: number; currency_id: string; start_date?: string };
};
type FakeCharge = {
  id: number;
  preapproval_id: string;
  status: string;
  transaction_amount: number;
  currency_id: string;
  date_created: string;
  debit_date: string;
  payment: { id: number; status: string; status_detail?: string };
};

const mp = {
  preapprovals: new Map<string, FakePreapproval>(),
  charges: new Map<string, FakeCharge>(),
  created: [] as Record<string, unknown>[],
  updates: [] as Array<{ id: string; body: Record<string, unknown> }>,
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
  const method = init?.method ?? "GET";
  const authHeader = new Headers(init?.headers).get("authorization");
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  if (url.origin !== "https://mp.test") throw new Error(`Unexpected fetch to ${url}`);

  if (url.pathname === "/oauth/token") {
    if (body.grant_type !== "client_credentials") return json(400, { error: "invalid_grant" });
    return json(200, { access_token: PLATFORM_TOKEN, user_id: 1, expires_in: 21_600 });
  }
  if (authHeader !== `Bearer ${PLATFORM_TOKEN}`) return json(401, { message: "unauthorized" });

  if (url.pathname === "/preapproval" && method === "POST") {
    mp.created.push(body);
    const id = `pre-${mp.preapprovals.size + 1}`;
    const preapproval: FakePreapproval = {
      id,
      status: "pending",
      init_point: `https://mp.test/subscriptions/checkout?preapproval_id=${id}`,
      external_reference: body.external_reference,
      payer_email: body.payer_email,
      reason: body.reason,
      next_payment_date: body.auto_recurring.start_date ?? null,
      auto_recurring: body.auto_recurring,
    };
    mp.preapprovals.set(id, preapproval);
    return json(201, preapproval);
  }
  if (url.pathname === "/preapproval/search") {
    const reference = url.searchParams.get("external_reference");
    return json(200, {
      results: [...mp.preapprovals.values()].filter((p) => p.external_reference === reference),
    });
  }
  const pre = url.pathname.match(/^\/preapproval\/([\w-]+)$/);
  if (pre?.[1]) {
    const preapproval = mp.preapprovals.get(pre[1]);
    if (!preapproval) return json(404, { message: "not found" });
    if (method === "PUT") {
      mp.updates.push({ id: pre[1], body });
      if (body.status) preapproval.status = body.status;
      if (body.auto_recurring?.transaction_amount) {
        preapproval.auto_recurring.transaction_amount = body.auto_recurring.transaction_amount;
      }
      if (body.reason) preapproval.reason = body.reason;
    }
    return json(200, preapproval);
  }
  if (url.pathname === "/authorized_payments/search") {
    const id = url.searchParams.get("preapproval_id");
    return json(200, { results: [...mp.charges.values()].filter((c) => c.preapproval_id === id) });
  }
  const charge = url.pathname.match(/^\/authorized_payments\/(\d+)$/);
  if (charge?.[1]) {
    const found = mp.charges.get(charge[1]);
    return found ? json(200, found) : json(404, { message: "not found" });
  }
  return json(404, { message: "no route" });
}

beforeAll(async () => {
  vi.stubGlobal("fetch", fakeFetch);
  app = await buildApp();
});

beforeEach(async () => {
  await client`truncate table users, audit_logs, page_visits cascade`;
  clearTestEmailOutbox();
  mp.preapprovals.clear();
  mp.charges.clear();
  mp.created.length = 0;
  mp.updates.length = 0;
  resetPlatformTokenCache();
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await app.close();
  await client.end({ timeout: 5 });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function createOwner(email: string, slug: string) {
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
  return { token, storeId: store.json().store.id as string, host: `${slug}.localhost` };
}

function signed(type: string, id: string) {
  const ts = String(Date.now());
  const requestId = `req-${type}-${id}-${ts}`;
  const v1 = createHmac("sha256", "test-webhook-secret")
    .update(`id:${id};request-id:${requestId};ts:${ts};`)
    .digest("hex");
  return app.inject({
    method: "POST",
    url: `/api/v1/payments/mercadopago/webhook?data.id=${id}&type=${type}`,
    headers: { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": requestId },
    payload: { type, data: { id } },
  });
}

async function subscriptionOf(token: string) {
  const res = await app.inject({
    method: "GET",
    url: "/api/v1/accounts/me/subscription",
    headers: auth(token),
  });
  return res.json().subscription;
}

function addCharge(
  preapprovalId: string,
  id: number,
  status: string,
  amount: number,
  debit = new Date(),
) {
  mp.charges.set(String(id), {
    id,
    preapproval_id: preapprovalId,
    status: status === "approved" ? "processed" : "recycling",
    transaction_amount: amount,
    currency_id: "ARS",
    date_created: debit.toISOString(),
    debit_date: debit.toISOString(),
    payment: {
      id: id * 10,
      status,
      status_detail: status === "rejected" ? "cc_rejected_insufficient_amount" : "accredited",
    },
  });
}

// ---------------------------------------------------------------------------

describe("platform subscriptions with Mercado Pago", () => {
  it("lists the plans that are for sale with their price", async () => {
    const owner = await createOwner("plans@example.com", "planes");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/billing/plans",
      headers: auth(owner.token),
    });
    expect(res.statusCode).toBe(200);
    const plans = res.json().plans as Array<{
      code: string;
      priceCents: number;
      features: { stats: boolean };
    }>;
    expect(plans.map((p) => [p.code, p.priceCents, p.features.stats])).toEqual([
      ["base", 1_500_000, false],
      ["pro", 2_000_000, true],
    ]);
  });

  it("charges after the trial, activates on payment and is idempotent", async () => {
    const owner = await createOwner("pay@example.com", "pagos");
    const before = await subscriptionOf(owner.token);
    expect(before.status).toBe("trial");

    const checkout = await app.inject({
      method: "POST",
      url: "/api/v1/accounts/me/subscription/checkout",
      headers: auth(owner.token),
      payload: { planCode: "base", payerEmail: "comprador@example.com" },
    });
    expect(checkout.statusCode).toBe(200);
    expect(checkout.json().url).toContain("https://mp.test/subscriptions/checkout");
    const sent = mp.created[0] as {
      auto_recurring: Record<string, unknown>;
      payer_email: string;
      external_reference: string;
    };
    expect(sent.payer_email).toBe("comprador@example.com");
    expect(sent.auto_recurring).toMatchObject({
      frequency: 1,
      frequency_type: "months",
      transaction_amount: 15000,
      currency_id: "ARS",
    });
    expect(new Date(String(sent.auto_recurring.start_date)).getTime()).toBe(
      new Date(before.trialEndsAt).getTime(),
    );
    expect(sent.external_reference).toBe(`sub:${before.id}`);

    // The photographer authorizes the charge in Mercado Pago.
    const pre = mp.preapprovals.get("pre-1");
    if (!pre) throw new Error("missing preapproval");
    pre.status = "authorized";
    expect((await signed("subscription_preapproval", "pre-1")).json().result).toBe("synced");
    let sub = await subscriptionOf(owner.token);
    expect(sub.status).toBe("trial");
    expect(sub.autoPayment).toMatchObject({ status: "authorized", planCode: "base" });

    // First monthly charge, at the end of the trial.
    addCharge("pre-1", 5001, "approved", 15000);
    expect((await signed("subscription_authorized_payment", "5001")).json().result).toBe("synced");
    sub = await subscriptionOf(owner.token);
    expect(sub.status).toBe("active");
    expect(sub.plan.code).toBe("base");
    const periodEnd = new Date(sub.currentPeriodEnd).getTime();
    expect(periodEnd).toBeGreaterThan(new Date(before.trialEndsAt).getTime() + 27 * 86_400_000);
    expect(
      testEmailOutbox.some(
        (m) => m.to === "pay@example.com" && m.subject.includes("Recibimos tu pago"),
      ),
    ).toBe(true);

    // The same notification again changes nothing.
    await signed("subscription_authorized_payment", "5001");
    await app.inject({
      method: "POST",
      url: "/api/v1/accounts/me/subscription/sync",
      headers: auth(owner.token),
    });
    sub = await subscriptionOf(owner.token);
    expect(new Date(sub.currentPeriodEnd).getTime()).toBe(periodEnd);
    const paymentRows = await client<
      { count: number }[]
    >`select count(*)::int as count from subscription_payments`;
    expect(paymentRows[0]?.count).toBe(1);

    const payments = await app.inject({
      method: "GET",
      url: "/api/v1/accounts/me/subscription/payments",
      headers: auth(owner.token),
    });
    expect(payments.json().payments).toHaveLength(1);
    expect(payments.json().payments[0]).toMatchObject({
      status: "approved",
      amountCents: 1_500_000,
      planName: "Base",
    });
  });

  it("upgrades to Profesional, unlocks statistics and counts visits", async () => {
    const owner = await createOwner("pro@example.com", "estudio-pro");
    await app.inject({
      method: "POST",
      url: "/api/v1/accounts/me/subscription/checkout",
      headers: auth(owner.token),
      payload: { planCode: "base" },
    });
    const pre = mp.preapprovals.get("pre-1");
    if (!pre) throw new Error("missing preapproval");
    pre.status = "authorized";
    addCharge("pre-1", 6001, "approved", 15000);
    await signed("subscription_authorized_payment", "6001");

    const locked = await app.inject({
      method: "GET",
      url: `/api/v1/stores/${owner.storeId}/stats`,
      headers: auth(owner.token),
    });
    expect(locked.statusCode).toBe(403);
    expect(locked.json().error.code).toBe("STATS_NOT_IN_PLAN");

    const upgrade = await app.inject({
      method: "POST",
      url: "/api/v1/accounts/me/subscription/checkout",
      headers: auth(owner.token),
      payload: { planCode: "pro" },
    });
    expect(upgrade.json().updated).toBe(true);
    expect(mp.updates.at(-1)?.body).toMatchObject({
      auto_recurring: { transaction_amount: 20000 },
    });
    expect((await subscriptionOf(owner.token)).plan.code).toBe("pro");

    const visit = (ua: string) =>
      app.inject({
        method: "POST",
        url: "/api/v1/public/visit",
        headers: { host: owner.host, "user-agent": ua },
      });
    expect((await visit("Mozilla/5.0 Firefox")).statusCode).toBe(204);
    await visit("Mozilla/5.0 Firefox");
    await visit("Mozilla/5.0 Safari");
    await visit("facebookexternalhit/1.1"); // bots are not counted

    const stats = await app.inject({
      method: "GET",
      url: `/api/v1/stores/${owner.storeId}/stats?days=7`,
      headers: auth(owner.token),
    });
    expect(stats.statusCode).toBe(200);
    const body = stats.json().stats;
    expect(body.series).toHaveLength(7);
    expect(body.totals).toMatchObject({ visitors: 2, views: 3, orders: 0, revenueCents: 0 });
    const hashRows = await client<
      { hashes: number }[]
    >`select count(*)::int as hashes from page_visits where visitor_hash like ${"%.%"}`;
    expect(hashRows[0]?.hashes).toBe(0);
  });

  it("cancels the automatic payment and keeps access until the period ends", async () => {
    const owner = await createOwner("cancel@example.com", "cancela");
    await app.inject({
      method: "POST",
      url: "/api/v1/accounts/me/subscription/checkout",
      headers: auth(owner.token),
      payload: { planCode: "base" },
    });
    const pre = mp.preapprovals.get("pre-1");
    if (!pre) throw new Error("missing preapproval");
    pre.status = "authorized";
    await signed("subscription_preapproval", "pre-1");

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/accounts/me/subscription/cancel",
      headers: auth(owner.token),
    });
    expect(res.statusCode).toBe(200);
    expect(mp.updates.at(-1)?.body).toEqual({ status: "cancelled" });
    const sub = res.json().subscription;
    expect(sub.cancelAtPeriodEnd).toBe(true);
    expect(sub.status).toBe("trial");
    expect(sub.isUsable).toBe(true);
  });

  it("warns the photographer when a charge fails", async () => {
    const owner = await createOwner("fail@example.com", "falla");
    await app.inject({
      method: "POST",
      url: "/api/v1/accounts/me/subscription/checkout",
      headers: auth(owner.token),
      payload: { planCode: "base" },
    });
    const pre = mp.preapprovals.get("pre-1");
    if (!pre) throw new Error("missing preapproval");
    pre.status = "authorized";
    addCharge("pre-1", 7001, "rejected", 15000);
    await signed("subscription_authorized_payment", "7001");
    expect(testEmailOutbox.filter((m) => m.subject.includes("No pudimos cobrar"))).toHaveLength(1);
    await signed("subscription_authorized_payment", "7001");
    expect(testEmailOutbox.filter((m) => m.subject.includes("No pudimos cobrar"))).toHaveLength(1);
    expect((await subscriptionOf(owner.token)).status).toBe("trial");
  });

  it("rejects unsigned subscription notifications", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/payments/mercadopago/webhook?data.id=pre-1&type=subscription_preapproval",
      headers: { "x-signature": "ts=1,v1=bad", "x-request-id": "x" },
      payload: { type: "subscription_preapproval", data: { id: "pre-1" } },
    });
    expect(res.statusCode).toBe(401);
  });

  it("reminds trials that end soon, once", async () => {
    await createOwner("remind@example.com", "recordar");
    await client`update subscriptions set trial_ends_at = now() + interval '2 days'`;
    clearTestEmailOutbox();
    expect(await sendTrialEndingReminders()).toBe(1);
    expect(await sendTrialEndingReminders()).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(testEmailOutbox.filter((m) => m.subject.includes("termina pronto"))).toHaveLength(1);
  });
});
