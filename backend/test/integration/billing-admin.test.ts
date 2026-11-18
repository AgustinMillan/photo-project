import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runAdminCli } from "../../src/admin/cli.js";
import { buildApp } from "../../src/app.js";
import { clearTestEmailOutbox, testEmailOutbox } from "../../src/modules/auth/auth.email.js";
import {
  activatePlan,
  addMonths,
  endPilot,
  extendSubscription,
  listSubscriptions,
  startPilot,
} from "../../src/modules/billing/billing.admin.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for integration tests.");
}

const client = postgres(databaseUrl, { max: 1 });
const PASSWORD = "CorrectHorseBatteryStaple!";
const DAY = 24 * 60 * 60 * 1000;

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

function auth(accessToken: string) {
  return { authorization: `Bearer ${accessToken}` };
}

async function createOwnerWithStore(email: string, slug: string) {
  const register = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: { email, password: PASSWORD, displayName: "Admin Test" },
  });
  expect(register.statusCode).toBe(201);

  const message = [...testEmailOutbox].reverse().find((m) => m.to === email);
  const token = message?.text.match(/token=([A-Za-z0-9_-]+)/)?.[1];
  expect(token).toBeTruthy();
  await app.inject({ method: "POST", url: "/api/v1/auth/verify-email", payload: { token } });

  const login = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, password: PASSWORD },
  });
  const accessToken = login.json().accessToken as string;

  const account = await app.inject({
    method: "POST",
    url: "/api/v1/accounts",
    headers: auth(accessToken),
    payload: { name: "Admin Studio" },
  });
  expect(account.statusCode).toBe(201);

  const store = await app.inject({
    method: "POST",
    url: "/api/v1/stores",
    headers: auth(accessToken),
    payload: { name: "Admin Store", slug },
  });
  expect(store.statusCode).toBe(201);

  return { accessToken };
}

async function subscriptionOf(accessToken: string) {
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/accounts/me/subscription",
    headers: auth(accessToken),
  });
  expect(response.statusCode).toBe(200);
  return response.json().subscription as {
    status: string;
    isPilot: boolean;
    isUsable: boolean;
    plan: { code: string };
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
    entitlements: Array<{ featureKey: string; enabled: boolean; limitValue: number | null }>;
  };
}

describe("admin billing operations", () => {
  it("starts new stores with a 30-day trial", async () => {
    const owner = await createOwnerWithStore("trial30@example.com", "trial-thirty");
    const subscription = await subscriptionOf(owner.accessToken);
    const days = (new Date(subscription.trialEndsAt ?? 0).getTime() - Date.now()) / DAY;
    expect(subscription.status).toBe("trial");
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
  });

  it("activates a paid plan, renews from the period end and logs the change", async () => {
    const owner = await createOwnerWithStore("paid@example.com", "paid-store");

    await activatePlan({ email: "PAID@example.com", planCode: "intermediate", months: 1 });
    const first = await subscriptionOf(owner.accessToken);
    expect(first).toMatchObject({ status: "active", plan: { code: "intermediate" } });
    const firstEnd = new Date(first.currentPeriodEnd ?? 0);

    await activatePlan({ email: "paid@example.com", planCode: "intermediate", months: 2 });
    const renewed = await subscriptionOf(owner.accessToken);
    expect(new Date(renewed.currentPeriodEnd ?? 0).toISOString()).toBe(
      addMonths(firstEnd, 2).toISOString(),
    );

    const events = await client`
      select event_type from subscription_events order by id`;
    expect(events.map((e) => e.event_type)).toEqual(["trial_started", "activated", "renewed"]);

    const audits = await client`
      select action, actor_type from audit_logs where action like 'subscription.admin%'`;
    expect(audits).toHaveLength(2);
    expect(audits[0]?.actor_type).toBe("admin_cli");
  });

  it("revives an expired trial with extra days", async () => {
    const owner = await createOwnerWithStore("lapsed@example.com", "lapsed-store");
    await client`update subscriptions set trial_ends_at = now() - interval '1 day'`;
    expect((await subscriptionOf(owner.accessToken)).status).toBe("expired");

    await extendSubscription({ email: "lapsed@example.com", days: 7 });
    const subscription = await subscriptionOf(owner.accessToken);
    expect(subscription.status).toBe("trial");
    const days = (new Date(subscription.trialEndsAt ?? 0).getTime() - Date.now()) / DAY;
    expect(days).toBeGreaterThan(6.9);
  });

  it("runs a pilot with every feature and no expiry, then ends it into a trial", async () => {
    const owner = await createOwnerWithStore("pilot@example.com", "pilot-store");

    await startPilot({ email: "pilot@example.com" });
    const pilot = await subscriptionOf(owner.accessToken);
    expect(pilot).toMatchObject({
      status: "active",
      isPilot: true,
      isUsable: true,
      plan: { code: "business" },
      currentPeriodEnd: null,
    });
    expect(pilot.entitlements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ featureKey: "team.enabled", enabled: true }),
      ]),
    );

    await expect(
      activatePlan({ email: "pilot@example.com", planCode: "base", months: 1 }),
    ).rejects.toMatchObject({ code: "PILOT_ACTIVE" });

    await endPilot({ email: "pilot@example.com" });
    const after = await subscriptionOf(owner.accessToken);
    expect(after).toMatchObject({ status: "trial", isPilot: false, plan: { code: "base" } });
    const days = (new Date(after.trialEndsAt ?? 0).getTime() - Date.now()) / DAY;
    expect(days).toBeGreaterThan(29.9);

    await expect(endPilot({ email: "pilot@example.com" })).rejects.toMatchObject({
      code: "NOT_A_PILOT",
    });
  });

  it("reports unknown accounts and lists everyone through the CLI", async () => {
    await createOwnerWithStore("listed@example.com", "listed-store");

    await expect(startPilot({ email: "nobody@example.com" })).rejects.toMatchObject({
      code: "ACCOUNT_NOT_FOUND",
    });

    const rows = await listSubscriptions();
    expect(rows).toEqual([
      expect.objectContaining({
        ownerEmail: "listed@example.com",
        status: "trial",
        planCode: "base",
      }),
    ]);

    expect(await runAdminCli(["pilot:start", "listed@example.com", "--note", "piloto"])).toBe(0);
    expect((await listSubscriptions())[0]?.isPilot).toBe(true);
    expect(await runAdminCli(["unknown"])).toBe(1);
  });
});
