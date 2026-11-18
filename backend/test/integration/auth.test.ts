import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { clearTestEmailOutbox, testEmailOutbox } from "../../src/modules/auth/auth.email.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for integration tests.");
}

const client = postgres(databaseUrl, { max: 1 });
const USER_EMAIL = "user@example.com";
const PASSWORD = "CorrectHorseBatteryStaple!";
const NEW_PASSWORD = "AnotherStrongPassword123!";

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

async function register(email = USER_EMAIL, password = PASSWORD, displayName = "Test User") {
  return app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: { email, password, displayName },
  });
}

async function login(email = USER_EMAIL, password = PASSWORD) {
  return app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, password },
  });
}

function getEmailToken(to: string, subject: string, index = -1): string {
  const messages = testEmailOutbox.filter(
    (message) => message.to === to && message.subject === subject,
  );
  const message = index < 0 ? messages.at(-1) : messages[index];

  if (!message) {
    throw new Error(`No "${subject}" email was sent to ${to}.`);
  }

  const match = message.text.match(/token=([A-Za-z0-9_-]+)/);

  if (!match?.[1]) {
    throw new Error(`No token found in the "${subject}" email.`);
  }

  return match[1];
}

function getRefreshCookie(response: LightMyRequestResponse): string {
  const setCookie = response.headers["set-cookie"];
  const rawCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;

  if (!rawCookie) {
    throw new Error("The response did not set a refresh cookie.");
  }

  return rawCookie.split(";")[0] ?? "";
}

async function registerAndVerify(email = USER_EMAIL, password = PASSWORD): Promise<void> {
  const registerResponse = await register(email, password);
  expect(registerResponse.statusCode).toBe(201);

  const token = getEmailToken(email, "Verificá tu email");
  const verifyResponse = await app.inject({
    method: "POST",
    url: "/api/v1/auth/verify-email",
    payload: { token },
  });

  expect(verifyResponse.statusCode).toBe(200);
}

async function loginAndGetCookie(email = USER_EMAIL, password = PASSWORD) {
  const response = await login(email, password);
  expect(response.statusCode).toBe(200);

  return {
    response,
    cookie: getRefreshCookie(response),
    body: response.json() as {
      accessToken: string;
      tokenType: string;
      expiresIn: number;
      user: { email: string; status: string };
    },
  };
}

describe("auth registration and email verification", () => {
  it("registers a user, normalizes the email and sends a verification link", async () => {
    const response = await register("  User@Example.COM ", PASSWORD, "  Test User  ");

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      user: {
        email: USER_EMAIL,
        displayName: "Test User",
        status: "pending_verification",
      },
    });
    expect(testEmailOutbox).toHaveLength(1);
    expect(testEmailOutbox[0]).toMatchObject({
      to: USER_EMAIL,
      subject: "Verificá tu email",
    });

    const rows = await client<{ email: string; status: string }[]>`
      select email, status from users
    `;

    expect(rows).toEqual([{ email: USER_EMAIL, status: "pending_verification" }]);
  });

  it("rejects duplicate registrations case-insensitively", async () => {
    expect((await register()).statusCode).toBe(201);

    const duplicate = await register("USER@example.com");

    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({
      error: { code: "EMAIL_ALREADY_REGISTERED" },
    });
  });

  it("rejects invalid registration input", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { email: "not-an-email", password: "short" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });

  it("verifies the email once and allows login afterwards", async () => {
    await registerAndVerify();

    const response = await login();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      tokenType: "Bearer",
      user: { email: USER_EMAIL, status: "active" },
    });
  });

  it("rejects a reused verification token", async () => {
    const response = await register();
    expect(response.statusCode).toBe(201);

    const token = getEmailToken(USER_EMAIL, "Verificá tu email");
    const firstVerify = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify-email",
      payload: { token },
    });
    const secondVerify = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify-email",
      payload: { token },
    });

    expect(firstVerify.statusCode).toBe(200);
    expect(secondVerify.statusCode).toBe(400);
    expect(secondVerify.json()).toMatchObject({
      error: { code: "INVALID_OR_EXPIRED_TOKEN" },
    });
  });

  it("invalidates the previous link when verification is resent", async () => {
    expect((await register()).statusCode).toBe(201);
    const firstToken = getEmailToken(USER_EMAIL, "Verificá tu email");

    const resend = await app.inject({
      method: "POST",
      url: "/api/v1/auth/resend-verification",
      payload: { email: USER_EMAIL },
    });

    expect(resend.statusCode).toBe(202);
    expect(testEmailOutbox).toHaveLength(2);

    const secondToken = getEmailToken(USER_EMAIL, "Verificá tu email");
    expect(secondToken).not.toBe(firstToken);

    const oldVerify = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify-email",
      payload: { token: firstToken },
    });
    const newVerify = await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify-email",
      payload: { token: secondToken },
    });

    expect(oldVerify.statusCode).toBe(400);
    expect(newVerify.statusCode).toBe(200);
  });

  it("does not reveal whether an unknown email can be resent", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/resend-verification",
      payload: { email: "unknown@example.com" },
    });

    expect(response.statusCode).toBe(202);
    expect(testEmailOutbox).toHaveLength(0);
  });
});

describe("auth login and access tokens", () => {
  it("rejects login before email verification", async () => {
    expect((await register()).statusCode).toBe(201);

    const response = await login();

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: { code: "EMAIL_NOT_VERIFIED" },
    });
  });

  it("rejects invalid credentials", async () => {
    await registerAndVerify();

    const response = await login(USER_EMAIL, "WrongPassword123!");

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: { code: "INVALID_CREDENTIALS" },
    });
  });

  it("returns the authenticated user from /me", async () => {
    await registerAndVerify();
    const { body } = await loginAndGetCookie();

    const me = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: `Bearer ${body.accessToken}` },
    });

    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      user: { email: USER_EMAIL, status: "active" },
    });
  });

  it("sets the refresh token in an HttpOnly cookie scoped to auth routes", async () => {
    await registerAndVerify();
    const { response } = await loginAndGetCookie();
    const setCookie = response.headers["set-cookie"];
    const rawCookie = Array.isArray(setCookie) ? setCookie.join("\n") : (setCookie ?? "");

    expect(rawCookie).toContain("HttpOnly");
    expect(rawCookie).toContain("SameSite=Lax");
    expect(rawCookie).toContain("Path=/api/v1/auth");
  });

  it("requires an access token for /me", async () => {
    const missing = await app.inject({ method: "GET", url: "/api/v1/auth/me" });
    const invalid = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: "Bearer not-a-valid-token" },
    });

    expect(missing.statusCode).toBe(401);
    expect(invalid.statusCode).toBe(401);
  });

  it("rejects requests from an untrusted origin", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { origin: "https://evil.example" },
      payload: { email: USER_EMAIL, password: PASSWORD },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: { code: "INVALID_ORIGIN" },
    });
  });
});

describe("refresh token rotation", () => {
  it("rotates refresh tokens and revokes the family when an old token is reused", async () => {
    await registerAndVerify();
    const { cookie: firstCookie } = await loginAndGetCookie();

    const refresh = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      headers: { cookie: firstCookie },
    });

    expect(refresh.statusCode).toBe(200);
    expect(refresh.json()).toMatchObject({ tokenType: "Bearer" });

    const secondCookie = getRefreshCookie(refresh);
    expect(secondCookie).not.toBe(firstCookie);

    const reuse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      headers: { cookie: firstCookie },
    });

    expect(reuse.statusCode).toBe(401);
    expect(reuse.json()).toMatchObject({
      error: { code: "REFRESH_TOKEN_REUSED" },
    });

    const afterReuse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      headers: { cookie: secondCookie },
    });

    expect(afterReuse.statusCode).toBe(401);
  });

  it("requires a refresh cookie", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: { code: "INVALID_REFRESH_TOKEN" },
    });
  });

  it("logs out the current session", async () => {
    await registerAndVerify();
    const { cookie } = await loginAndGetCookie();

    const logout = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { cookie },
    });

    expect(logout.statusCode).toBe(204);

    const refresh = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      headers: { cookie },
    });

    expect(refresh.statusCode).toBe(401);
  });

  it("can log out all sessions", async () => {
    await registerAndVerify();
    const first = await loginAndGetCookie();
    const second = await loginAndGetCookie();

    const logoutAll = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { cookie: first.cookie },
      payload: { allDevices: true },
    });

    expect(logoutAll.statusCode).toBe(204);

    const firstRefresh = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      headers: { cookie: first.cookie },
    });
    const secondRefresh = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      headers: { cookie: second.cookie },
    });

    expect(firstRefresh.statusCode).toBe(401);
    expect(secondRefresh.statusCode).toBe(401);
  });
});

describe("password reset", () => {
  it("resets the password, revokes sessions and rejects the token afterwards", async () => {
    await registerAndVerify();
    const { cookie } = await loginAndGetCookie();

    const forgot = await app.inject({
      method: "POST",
      url: "/api/v1/auth/forgot-password",
      payload: { email: USER_EMAIL },
    });

    expect(forgot.statusCode).toBe(202);

    const token = getEmailToken(USER_EMAIL, "Restablecé tu contraseña");
    const reset = await app.inject({
      method: "POST",
      url: "/api/v1/auth/reset-password",
      payload: { token, newPassword: NEW_PASSWORD },
    });

    expect(reset.statusCode).toBe(200);

    const oldLogin = await login(USER_EMAIL, PASSWORD);
    const newLogin = await login(USER_EMAIL, NEW_PASSWORD);

    expect(oldLogin.statusCode).toBe(401);
    expect(newLogin.statusCode).toBe(200);

    const oldRefresh = await app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      headers: { cookie },
    });
    expect(oldRefresh.statusCode).toBe(401);

    const reuse = await app.inject({
      method: "POST",
      url: "/api/v1/auth/reset-password",
      payload: { token, newPassword: PASSWORD },
    });

    expect(reuse.statusCode).toBe(400);
    expect(reuse.json()).toMatchObject({
      error: { code: "INVALID_OR_EXPIRED_TOKEN" },
    });
  });

  it("does not reveal whether an unknown email exists", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/forgot-password",
      payload: { email: "unknown@example.com" },
    });

    expect(response.statusCode).toBe(202);
    expect(testEmailOutbox).toHaveLength(0);
  });
});
