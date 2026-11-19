import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../../config/env.js";
import { AppError } from "../../shared/errors/app-error.js";

/**
 * Thin client for the Mercado Pago REST API (OAuth marketplace + Checkout Pro).
 * Base URLs are configurable so tests can point them at a fake server.
 */

export type MpTokenResponse = {
  access_token: string;
  refresh_token?: string;
  public_key?: string;
  user_id: number | string;
  expires_in?: number;
  live_mode?: boolean;
};

export type MpPreference = { id: string; init_point: string; sandbox_init_point?: string };

export type MpPayment = {
  id: number | string;
  status: string;
  status_detail?: string;
  external_reference?: string | null;
  transaction_amount: number;
  currency_id: string;
  collector_id?: number | string;
  date_approved?: string | null;
};

export function mercadoPagoConfigured(): boolean {
  return Boolean(env.MP_CLIENT_ID && env.MP_CLIENT_SECRET);
}

function mercadoPagoBaseUrl(): string {
  return env.MP_PUBLIC_BASE_URL ?? env.APP_URL;
}

export function mercadoPagoRedirectUri(): string {
  return new URL("/api/v1/payments/mercadopago/callback", mercadoPagoBaseUrl()).toString();
}

export function mercadoPagoWebhookUrl(storeId: string): string {
  const url = new URL("/api/v1/payments/mercadopago/webhook", mercadoPagoBaseUrl());
  url.searchParams.set("store", storeId);
  return url.toString();
}

function upstreamError(status: number, body: unknown): AppError {
  return new AppError({
    statusCode: 502,
    code: "PAYMENT_PROVIDER_ERROR",
    message: "Mercado Pago rejected the request.",
    details: { status, body },
  });
}

async function request<T>(
  method: string,
  path: string,
  options: { token?: string; body?: unknown; base?: string } = {},
): Promise<T> {
  const response = await fetch(`${options.base ?? env.MP_API_BASE}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) throw upstreamError(response.status, data);
  return data as T;
}

export function authorizationUrl(state: string, codeChallenge?: string): string {
  const url = new URL("/authorization", env.MP_AUTH_BASE);
  url.searchParams.set("client_id", env.MP_CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("platform_id", "mp");
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", mercadoPagoRedirectUri());
  if (codeChallenge) {
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
  return url.toString();
}

export function exchangeAuthorizationCode(code: string, codeVerifier?: string) {
  return request<MpTokenResponse>("POST", "/oauth/token", {
    body: {
      client_id: env.MP_CLIENT_ID,
      client_secret: env.MP_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: mercadoPagoRedirectUri(),
      ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
    },
  });
}

export function refreshAccessToken(refreshToken: string) {
  return request<MpTokenResponse>("POST", "/oauth/token", {
    body: {
      client_id: env.MP_CLIENT_ID,
      client_secret: env.MP_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    },
  });
}

export function createPreference(sellerToken: string, body: Record<string, unknown>) {
  return request<MpPreference>("POST", "/checkout/preferences", { token: sellerToken, body });
}

export function getPayment(sellerToken: string, paymentId: string) {
  return request<MpPayment>("GET", `/v1/payments/${encodeURIComponent(paymentId)}`, {
    token: sellerToken,
  });
}

export async function searchPaymentsByReference(sellerToken: string, externalReference: string) {
  const query = new URLSearchParams({
    external_reference: externalReference,
    sort: "date_created",
    criteria: "desc",
  });
  const result = await request<{ results?: MpPayment[] }>("GET", `/v1/payments/search?${query}`, {
    token: sellerToken,
  });
  return result.results ?? [];
}

// --- Platform subscriptions (preapproval), charged to the app owner's account ---

export type MpPreapproval = {
  id: string;
  status: string; // pending | authorized | paused | cancelled
  init_point?: string;
  external_reference?: string | null;
  payer_email?: string | null;
  reason?: string;
  next_payment_date?: string | null;
  auto_recurring?: { transaction_amount?: number; currency_id?: string; start_date?: string };
};

export type MpAuthorizedPayment = {
  id: number | string;
  preapproval_id: string;
  status: string; // scheduled | processed | recycling | cancelled
  transaction_amount: number;
  currency_id: string;
  date_created?: string;
  debit_date?: string | null;
  last_modified?: string;
  payment?: { id?: number | string; status?: string; status_detail?: string } | null;
};

let platformToken: { value: string; expiresAt: number } | null = null;

/** Access token of the account that owns the app, via client credentials. */
export async function platformAccessToken(): Promise<string> {
  if (env.MP_PLATFORM_ACCESS_TOKEN) return env.MP_PLATFORM_ACCESS_TOKEN;
  if (platformToken && platformToken.expiresAt > Date.now() + 60_000) return platformToken.value;
  const token = await request<MpTokenResponse>("POST", "/oauth/token", {
    body: {
      client_id: env.MP_CLIENT_ID,
      client_secret: env.MP_CLIENT_SECRET,
      grant_type: "client_credentials",
    },
  });
  platformToken = {
    value: token.access_token,
    expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
  };
  return token.access_token;
}

export function resetPlatformTokenCache(): void {
  platformToken = null;
}

export async function createPreapproval(body: Record<string, unknown>) {
  return request<MpPreapproval>("POST", "/preapproval", {
    token: await platformAccessToken(),
    body,
  });
}

export async function getPreapproval(id: string) {
  return request<MpPreapproval>("GET", `/preapproval/${encodeURIComponent(id)}`, {
    token: await platformAccessToken(),
  });
}

export async function updatePreapproval(id: string, body: Record<string, unknown>) {
  return request<MpPreapproval>("PUT", `/preapproval/${encodeURIComponent(id)}`, {
    token: await platformAccessToken(),
    body,
  });
}

export async function searchPreapprovals(externalReference: string) {
  const query = new URLSearchParams({ external_reference: externalReference, limit: "10" });
  const result = await request<{ results?: MpPreapproval[] }>(
    "GET",
    `/preapproval/search?${query}`,
    { token: await platformAccessToken() },
  );
  return result.results ?? [];
}

export async function getAuthorizedPayment(id: string) {
  return request<MpAuthorizedPayment>("GET", `/authorized_payments/${encodeURIComponent(id)}`, {
    token: await platformAccessToken(),
  });
}

/** Every charge of a preapproval (Mercado Pago pages this search by 10). */
export async function searchAuthorizedPayments(preapprovalId: string) {
  const token = await platformAccessToken();
  const all: MpAuthorizedPayment[] = [];
  for (let offset = 0; offset < 500; offset += 10) {
    const query = new URLSearchParams({
      preapproval_id: preapprovalId,
      limit: "10",
      offset: String(offset),
    });
    const result = await request<{
      results?: MpAuthorizedPayment[];
      paging?: { total?: number };
    }>("GET", `/authorized_payments/search?${query}`, { token });
    const page = result.results ?? [];
    all.push(...page);
    const total = result.paging?.total ?? all.length;
    if (page.length < 10 || all.length >= total) break;
  }
  return all;
}

/**
 * Validates the `x-signature` header of a webhook: HMAC-SHA256 (hex) of
 * "id:<data.id>;request-id:<x-request-id>;ts:<ts>;" with the app's webhook
 * secret. Parts absent from the request are omitted from the manifest.
 */
export function webhookSecrets(): string[] {
  return env.MP_WEBHOOK_SECRET.split(",")
    .map((secret) => secret.trim())
    .filter(Boolean);
}

export function verifyWebhookSignature(input: {
  signature: string | undefined;
  requestId: string | undefined;
  dataId: string | undefined;
}): boolean {
  if (!env.MP_WEBHOOK_SECRET || !input.signature) return false;
  const parts = Object.fromEntries(
    input.signature.split(",").map((part) => {
      const [k, ...v] = part.split("=");
      return [k?.trim() ?? "", v.join("=").trim()];
    }),
  );
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;

  let manifest = "";
  if (input.dataId)
    manifest += `id:${/^[a-z0-9]+$/i.test(input.dataId) ? input.dataId.toLowerCase() : input.dataId};`;
  if (input.requestId) manifest += `request-id:${input.requestId};`;
  manifest += `ts:${ts};`;

  const received = Buffer.from(v1);
  // Several secrets may be configured (comma-separated): Mercado Pago signs
  // test-mode and production notifications with different keys.
  return webhookSecrets().some((secret) => {
    const expected = Buffer.from(createHmac("sha256", secret).update(manifest).digest("hex"));
    return expected.length === received.length && timingSafeEqual(expected, received);
  });
}
