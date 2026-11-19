import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { clearTestEmailOutbox, testEmailOutbox } from "../../src/modules/auth/auth.email.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for integration tests.");

const client = postgres(databaseUrl, { max: 1 });
const PASSWORD = "CorrectHorseBatteryStaple!";
const UA = "Mozilla/5.0 (Macintosh) Safari";
let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

beforeEach(async () => {
  await client`truncate table users, audit_logs, page_visits cascade`;
  clearTestEmailOutbox();
});

afterAll(async () => {
  await app.close();
  await client.end({ timeout: 5 });
});

async function login(email: string, attribution?: Record<string, unknown>) {
  await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: {
      email,
      password: PASSWORD,
      displayName: "X",
      ...(attribution ? { attribution } : {}),
    },
  });
  const message = [...testEmailOutbox].reverse().find((m) => m.to === email);
  const token = message?.text.match(/token=([A-Za-z0-9_-]+)/)?.[1];
  await app.inject({ method: "POST", url: "/api/v1/auth/verify-email", payload: { token } });
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, password: PASSWORD },
  });
  return res.json().accessToken as string;
}

describe("visit and sign-up attribution", () => {
  it("records where landing visitors and sign-ups come from", async () => {
    const ad = {
      utmSource: "instagram",
      utmMedium: "paid",
      utmCampaign: "prueba-nov",
      utmContent: "wetransfer",
    };
    const visit = (ip: string, body: Record<string, unknown>) =>
      app.inject({
        method: "POST",
        url: "/api/v1/public/visit",
        headers: { host: "localhost", "user-agent": UA, "x-forwarded-for": ip },
        payload: body,
      });
    expect((await visit("10.0.0.1", ad)).statusCode).toBe(204);
    await visit("10.0.0.1", {}); // same visitor, same day: keeps the first source
    await visit("10.0.0.2", { referrer: "https://www.google.com/" });
    await visit("10.0.0.3", {});

    const rows = await client<{ source: string; campaign: string; views: number }[]>`
      select source, campaign, views from page_visits order by source`;
    expect(rows).toEqual([
      { source: "", campaign: "", views: 1 },
      { source: "google", campaign: "", views: 1 },
      { source: "instagram", campaign: "prueba-nov", views: 2 },
    ]);

    await login("ad@example.com", { ...ad, path: "/?utm_source=instagram" });
    await login("direct@example.com");
    const attributed = await client<{ email: string; source: string; content: string }[]>`
      select u.email, ua.source, ua.content from user_attribution ua join users u on u.id = ua.user_id
      order by u.email`;
    expect(attributed).toEqual([
      { email: "ad@example.com", source: "instagram", content: "wetransfer" },
      { email: "direct@example.com", source: "", content: "" },
    ]);

    const founder = await login("founder@example.com");
    const report = await app.inject({
      method: "GET",
      url: "/api/v1/admin/attribution?days=7",
      headers: { authorization: `Bearer ${founder}` },
    });
    expect(report.statusCode).toBe(200);
    const instagram = report
      .json()
      .rows.find((row: { source: string }) => row.source === "instagram");
    expect(instagram).toMatchObject({
      campaign: "prueba-nov",
      content: "wetransfer",
      visitors: 1,
      signups: 1,
      withStore: 0,
    });
  });

  it("hides the report from non-admins", async () => {
    const token = await login("someone@example.com");
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/attribution",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
