import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { clearTestEmailOutbox, testEmailOutbox } from "../../src/modules/auth/auth.email.js";
import { assertStorePurchasesEnabled } from "../../src/modules/billing/billing.service.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for integration tests.");
}

const client = postgres(databaseUrl, { max: 1 });
const PASSWORD = "CorrectHorseBatteryStaple!";
const OWNER_EMAIL = "billing-owner@example.com";

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

function authHeaders(accessToken: string) {
  return { authorization: `Bearer ${accessToken}` };
}

function findEmailLink(to: string, path: string): string {
  const message = [...testEmailOutbox]
    .reverse()
    .find((candidate) => candidate.to === to && candidate.text.includes(path));

  if (!message) {
    throw new Error(`No email containing "${path}" was sent to ${to}.`);
  }

  const match = message.text.match(/token=([A-Za-z0-9_-]+)/);

  if (!match?.[1]) {
    throw new Error(`No token found in the email sent to ${to}.`);
  }

  return match[1];
}

async function createVerifiedUser(email: string, displayName = "Billing Owner") {
  const registerResponse = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: { email, password: PASSWORD, displayName },
  });

  expect(registerResponse.statusCode).toBe(201);

  const verificationToken = findEmailLink(email, "/verify-email?token=");
  const verifyResponse = await app.inject({
    method: "POST",
    url: "/api/v1/auth/verify-email",
    payload: { token: verificationToken },
  });

  expect(verifyResponse.statusCode).toBe(200);

  const loginResponse = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, password: PASSWORD },
  });

  expect(loginResponse.statusCode).toBe(200);

  const body = loginResponse.json() as {
    accessToken: string;
    user: { id: string; email: string };
  };

  return {
    email,
    id: body.user.id,
    accessToken: body.accessToken,
  };
}

async function createAccount(accessToken: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/accounts",
    headers: authHeaders(accessToken),
    payload: { name: "Billing Studio" },
  });

  expect(response.statusCode).toBe(201);
  return response.json().account as { id: string };
}

async function createStore(
  accessToken: string,
  payload: { name: string; slug: string; planCode?: string },
) {
  return app.inject({
    method: "POST",
    url: "/api/v1/stores",
    headers: authHeaders(accessToken),
    payload,
  });
}

async function getSubscription(accessToken: string) {
  return app.inject({
    method: "GET",
    url: "/api/v1/accounts/me/subscription",
    headers: authHeaders(accessToken),
  });
}

describe("Phase 2 subscriptions and entitlements", () => {
  it("starts a Base trial on the first store and exposes its status and entitlements", async () => {
    const owner = await createVerifiedUser(OWNER_EMAIL);
    await createAccount(owner.accessToken);

    const beforeStore = await getSubscription(owner.accessToken);
    expect(beforeStore.statusCode).toBe(200);
    expect(beforeStore.json().subscription).toBeNull();

    const storeResponse = await createStore(owner.accessToken, {
      name: "Base Store",
      slug: "base-store",
    });
    expect(storeResponse.statusCode).toBe(201);
    const store = storeResponse.json().store as { id: string };

    const subscriptionResponse = await getSubscription(owner.accessToken);
    expect(subscriptionResponse.statusCode).toBe(200);
    const subscription = subscriptionResponse.json().subscription as {
      status: string;
      isUsable: boolean;
      plan: { code: string };
      trialEndsAt: string;
      entitlements: Array<{ featureKey: string; enabled: boolean; limitValue: number | null }>;
    };

    expect(subscription).toMatchObject({
      status: "trial",
      isUsable: true,
      plan: { code: "base" },
    });
    expect(new Date(subscription.trialEndsAt).getTime()).toBeGreaterThan(Date.now());
    expect(subscription.entitlements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ featureKey: "stores.max", enabled: true, limitValue: 1 }),
        expect.objectContaining({ featureKey: "team.enabled", enabled: false }),
        expect.objectContaining({ featureKey: "purchases.enabled", enabled: true }),
      ]),
    );

    const entitlementsResponse = await app.inject({
      method: "GET",
      url: "/api/v1/accounts/me/entitlements",
      headers: authHeaders(owner.accessToken),
    });
    expect(entitlementsResponse.statusCode).toBe(200);
    expect(entitlementsResponse.json().entitlements["stores.max"]).toMatchObject({
      enabled: true,
      limitValue: 1,
    });

    const featuresResponse = await app.inject({
      method: "GET",
      url: `/api/v1/stores/${store.id}/features`,
      headers: authHeaders(owner.accessToken),
    });
    expect(featuresResponse.statusCode).toBe(200);
    expect(featuresResponse.json().entitlements["team.enabled"].enabled).toBe(false);

    const resolved = await app.inject({
      method: "GET",
      url: "/api/v1/public/stores/resolve",
      headers: { host: "base-store.localhost" },
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().store).toMatchObject({ id: store.id, purchasesEnabled: true });
  });

  it.each(["base", "intermediate"] as const)(
    "prevents a second store on %s and reports STORE_LIMIT_REACHED",
    async (planCode) => {
      const owner = await createVerifiedUser(`billing-${planCode}@example.com`);
      await createAccount(owner.accessToken);

      const first = await createStore(owner.accessToken, {
        name: `First ${planCode}`,
        slug: `first-${planCode}`,
        planCode,
      });
      expect(first.statusCode).toBe(201);

      const second = await createStore(owner.accessToken, {
        name: `Second ${planCode}`,
        slug: `second-${planCode}`,
      });
      expect(second.statusCode).toBe(409);
      expect(second.json().error.code).toBe("STORE_LIMIT_REACHED");

      const [counts] = await client<{ stores: number; subscriptions: number }[]>`
        select
          (select count(*)::int from stores) as stores,
          (select count(*)::int from subscriptions) as subscriptions
      `;
      expect(counts).toEqual({ stores: 1, subscriptions: 1 });
    },
  );

  it("allows Business stores up to the configured limit", async () => {
    const owner = await createVerifiedUser(OWNER_EMAIL);
    await createAccount(owner.accessToken);

    for (let index = 0; index < 10; index += 1) {
      const response = await createStore(owner.accessToken, {
        name: `Business ${index + 1}`,
        slug: `business-${index + 1}`,
        ...(index === 0 ? { planCode: "business" } : {}),
      });
      expect(response.statusCode).toBe(201);
    }

    const overLimit = await createStore(owner.accessToken, {
      name: "Business 11",
      slug: "business-11",
    });
    expect(overLimit.statusCode).toBe(409);
    expect(overLimit.json().error.code).toBe("STORE_LIMIT_REACHED");
    expect(overLimit.json().error.details).toMatchObject({ limit: 10, current: 10 });
  });

  it("disables team operations on plans without the team entitlement", async () => {
    const owner = await createVerifiedUser(OWNER_EMAIL);
    await createAccount(owner.accessToken);
    const storeResponse = await createStore(owner.accessToken, {
      name: "No Team",
      slug: "no-team",
    });
    expect(storeResponse.statusCode).toBe(201);
    const store = storeResponse.json().store as { id: string };

    const members = await app.inject({
      method: "GET",
      url: `/api/v1/stores/${store.id}/members`,
      headers: authHeaders(owner.accessToken),
    });
    expect(members.statusCode).toBe(403);
    expect(members.json().error.code).toBe("TEAM_FEATURE_DISABLED");

    const invitation = await app.inject({
      method: "POST",
      url: `/api/v1/stores/${store.id}/invitations`,
      headers: authHeaders(owner.accessToken),
      payload: { email: "member@example.com", role: "EDITOR" },
    });
    expect(invitation.statusCode).toBe(403);
    expect(invitation.json().error.code).toBe("TEAM_FEATURE_DISABLED");
  });

  it("enforces the configured team member limit", async () => {
    const owner = await createVerifiedUser(OWNER_EMAIL);
    await createAccount(owner.accessToken);
    const storeResponse = await createStore(owner.accessToken, {
      name: "Team Limit",
      slug: "team-limit",
      planCode: "business",
    });
    expect(storeResponse.statusCode).toBe(201);
    const store = storeResponse.json().store as { id: string };

    await client`
      update plan_entitlements
      set limit_value = 1
      where feature_key = 'team.max_members'
        and plan_id = (select id from plans where code = 'business')
    `;

    try {
      const invitation = await app.inject({
        method: "POST",
        url: `/api/v1/stores/${store.id}/invitations`,
        headers: authHeaders(owner.accessToken),
        payload: { email: "blocked@example.com", role: "EDITOR" },
      });

      expect(invitation.statusCode).toBe(409);
      expect(invitation.json().error.code).toBe("TEAM_MEMBER_LIMIT_REACHED");
    } finally {
      await client`
        update plan_entitlements
        set limit_value = 10
        where feature_key = 'team.max_members'
          and plan_id = (select id from plans where code = 'business')
      `;
    }
  });

  it("blocks sales when the plan disables the purchases entitlement", async () => {
    const owner = await createVerifiedUser(OWNER_EMAIL);
    await createAccount(owner.accessToken);
    const storeResponse = await createStore(owner.accessToken, {
      name: "No Purchases",
      slug: "no-purchases",
    });
    expect(storeResponse.statusCode).toBe(201);
    const store = storeResponse.json().store as { id: string };

    await client`
      update plan_entitlements
      set enabled = false
      where feature_key = 'purchases.enabled'
        and plan_id = (select id from plans where code = 'base')
    `;

    try {
      const salesStatus = await app.inject({
        method: "GET",
        url: `/api/v1/stores/${store.id}/sales-status`,
        headers: authHeaders(owner.accessToken),
      });
      expect(salesStatus.statusCode).toBe(200);
      expect(salesStatus.json().sales).toEqual({
        enabled: false,
        reason: "PLAN_PURCHASES_DISABLED",
      });

      await expect(assertStorePurchasesEnabled(store.id)).rejects.toMatchObject({
        code: "STORE_PURCHASES_DISABLED",
        details: { reason: "PLAN_PURCHASES_DISABLED" },
      });
    } finally {
      await client`
        update plan_entitlements
        set enabled = true
        where feature_key = 'purchases.enabled'
          and plan_id = (select id from plans where code = 'base')
      `;
    }
  });

  it("expires the trial lazily, blocks new sales and keeps the store readable", async () => {
    const owner = await createVerifiedUser(OWNER_EMAIL);
    await createAccount(owner.accessToken);
    const storeResponse = await createStore(owner.accessToken, {
      name: "Expiring Store",
      slug: "expiring-store",
    });
    expect(storeResponse.statusCode).toBe(201);
    const store = storeResponse.json().store as { id: string };

    await client`
      update subscriptions
      set trial_ends_at = now() - interval '1 minute'
      where account_id = (select id from accounts where owner_user_id = ${owner.id})
    `;

    const subscriptionResponse = await getSubscription(owner.accessToken);
    expect(subscriptionResponse.statusCode).toBe(200);
    expect(subscriptionResponse.json().subscription).toMatchObject({
      status: "expired",
      isUsable: false,
    });

    const secondStore = await createStore(owner.accessToken, {
      name: "After Expiry",
      slug: "after-expiry",
    });
    expect(secondStore.statusCode).toBe(403);
    expect(secondStore.json().error.code).toBe("SUBSCRIPTION_INACTIVE");

    const salesStatus = await app.inject({
      method: "GET",
      url: `/api/v1/stores/${store.id}/sales-status`,
      headers: authHeaders(owner.accessToken),
    });
    expect(salesStatus.statusCode).toBe(200);
    expect(salesStatus.json().sales).toEqual({
      enabled: false,
      reason: "SUBSCRIPTION_INACTIVE",
    });

    await expect(assertStorePurchasesEnabled(store.id)).rejects.toMatchObject({
      code: "STORE_PURCHASES_DISABLED",
      details: { reason: "SUBSCRIPTION_INACTIVE" },
    });

    const storeRead = await app.inject({
      method: "GET",
      url: `/api/v1/stores/${store.id}`,
      headers: authHeaders(owner.accessToken),
    });
    expect(storeRead.statusCode).toBe(200);

    const resolved = await app.inject({
      method: "GET",
      url: "/api/v1/public/stores/resolve",
      headers: { host: "expiring-store.localhost" },
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().store).toMatchObject({
      id: store.id,
      purchasesEnabled: false,
    });

    const events = await client<{ event_type: string }[]>`
      select event_type
      from subscription_events
      order by id
    `;
    expect(events.map((event) => event.event_type)).toEqual(["trial_started", "expired"]);
  });

  it("rejects an unknown trial plan without creating partial state", async () => {
    const owner = await createVerifiedUser(OWNER_EMAIL);
    await createAccount(owner.accessToken);

    const response = await createStore(owner.accessToken, {
      name: "Unknown Plan",
      slug: "unknown-plan",
      planCode: "missing-plan",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("PLAN_NOT_FOUND");

    const [counts] = await client<{ stores: number; subscriptions: number }[]>`
      select
        (select count(*)::int from stores) as stores,
        (select count(*)::int from subscriptions) as subscriptions
    `;
    expect(counts).toEqual({ stores: 0, subscriptions: 0 });
  });

  it("only allows selecting a plan when the trial is created", async () => {
    const owner = await createVerifiedUser(OWNER_EMAIL);
    await createAccount(owner.accessToken);
    expect(
      (
        await createStore(owner.accessToken, {
          name: "Locked Plan",
          slug: "locked-plan",
        })
      ).statusCode,
    ).toBe(201);

    const response = await createStore(owner.accessToken, {
      name: "Plan Change",
      slug: "plan-change",
      planCode: "business",
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("PLAN_CHANGE_NOT_ALLOWED");
  });
});
