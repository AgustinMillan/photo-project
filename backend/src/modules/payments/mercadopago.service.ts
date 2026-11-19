import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { env } from "../../config/env.js";
import { db } from "../../db/client.js";
import { auditLogs, orders, storePaymentAccounts, stores } from "../../db/schema/index.js";
import { open, seal } from "../../shared/crypto/secretbox.js";
import { AppError } from "../../shared/errors/app-error.js";
import { logger } from "../../shared/logger.js";
import {
  handleSubscriptionWebhook,
  SUBSCRIPTION_WEBHOOK_TYPES,
} from "../billing/billing.mercadopago.js";
import {
  notifyOrderPaid,
  orderAccessToken,
  settleOrderPayment,
  storeHostname,
} from "../orders/orders.service.js";
import { getStoreAccess, type StoreAccess } from "../stores/store-access.js";
import {
  authorizationUrl,
  createPreference,
  exchangeAuthorizationCode,
  getPayment,
  type MpPayment,
  type MpTokenResponse,
  mercadoPagoConfigured,
  mercadoPagoWebhookUrl,
  refreshAccessToken,
  searchPaymentsByReference,
  verifyWebhookSignature,
} from "./mercadopago.client.js";

const STATE_TTL_MS = 15 * 60 * 1000;
const REFRESH_MARGIN_MS = 7 * 24 * 60 * 60 * 1000;

function requireConfigured(): void {
  if (!mercadoPagoConfigured()) {
    throw new AppError({
      statusCode: 503,
      code: "MERCADOPAGO_NOT_CONFIGURED",
      message: "Mercado Pago is not enabled on this platform yet.",
    });
  }
}

// ---------------------------------------------------------------------------
// OAuth state (signed, stateless) and PKCE verifier derived from it
// ---------------------------------------------------------------------------

function stateKey(): string {
  return `mp-oauth-state:${env.JWT_ACCESS_SECRET}`;
}

function signState(payload: { s: string; u: string; e: number; n: string }): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", stateKey()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function readState(state: string): { storeId: string; userId: string } | null {
  const [body, mac] = state.split(".");
  if (!body || !mac) return null;
  const expected = Buffer.from(createHmac("sha256", stateKey()).update(body).digest("base64url"));
  const received = Buffer.from(mac);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
      s: string;
      u: string;
      e: number;
    };
    if (typeof payload.e !== "number" || payload.e < Date.now()) return null;
    return { storeId: payload.s, userId: payload.u };
  } catch {
    return null;
  }
}

/** The verifier is derived from the signed state, so nothing has to be stored. */
function pkceVerifier(state: string): string {
  return createHmac("sha256", `mp-pkce:${env.JWT_ACCESS_SECRET}`).update(state).digest("base64url");
}

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

export async function getMercadoPagoConnection(access: StoreAccess) {
  const [account] = await db
    .select({
      providerUserId: storePaymentAccounts.providerUserId,
      liveMode: storePaymentAccounts.liveMode,
      connectedAt: storePaymentAccounts.connectedAt,
      expiresAt: storePaymentAccounts.expiresAt,
    })
    .from(storePaymentAccounts)
    .where(eq(storePaymentAccounts.storeId, access.store.id))
    .limit(1);

  return {
    available: mercadoPagoConfigured(),
    connected: Boolean(account),
    account: account ?? null,
    platformFeePercent: env.PLATFORM_FEE_PERCENT,
  };
}

export function startMercadoPagoConnect(access: StoreAccess): { url: string } {
  requireConfigured();
  const state = signState({
    s: access.store.id,
    u: access.userId,
    e: Date.now() + STATE_TTL_MS,
    n: randomBytes(8).toString("base64url"),
  });
  const challenge = env.MP_USE_PKCE ? pkceChallenge(pkceVerifier(state)) : undefined;
  return { url: authorizationUrl(state, challenge) };
}

function sealTokens(tokens: MpTokenResponse) {
  return {
    providerUserId: String(tokens.user_id),
    accessTokenEnc: seal(tokens.access_token),
    refreshTokenEnc: tokens.refresh_token ? seal(tokens.refresh_token) : null,
    publicKey: tokens.public_key ?? null,
    liveMode: tokens.live_mode ?? true,
    expiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
  };
}

/** OAuth redirect target. Returns the store id that was connected. */
export async function completeMercadoPagoConnect(code: string, state: string): Promise<string> {
  requireConfigured();
  const parsed = readState(state);
  if (!parsed) {
    throw new AppError({
      statusCode: 400,
      code: "INVALID_OAUTH_STATE",
      message: "The link expired. Try again.",
    });
  }

  // Re-check access at the time of the callback: only the owner may connect.
  const access = await getStoreAccess(parsed.userId, parsed.storeId);
  if (access?.role !== "OWNER") {
    throw new AppError({
      statusCode: 403,
      code: "FORBIDDEN",
      message: "Only the store owner can connect payments.",
    });
  }

  const tokens = await exchangeAuthorizationCode(
    code,
    env.MP_USE_PKCE ? pkceVerifier(state) : undefined,
  );
  const values = sealTokens(tokens);
  const now = new Date();

  await db
    .insert(storePaymentAccounts)
    .values({
      storeId: access.store.id,
      ...values,
      connectedByUserId: access.userId,
      connectedAt: now,
    })
    .onConflictDoUpdate({
      target: storePaymentAccounts.storeId,
      set: { ...values, connectedByUserId: access.userId, connectedAt: now, updatedAt: now },
    });

  await db.insert(auditLogs).values({
    accountId: access.account.id,
    storeId: access.store.id,
    actorUserId: access.userId,
    action: "payments.mercadopago_connected",
    entityType: "store",
    entityId: access.store.id,
    after: { providerUserId: values.providerUserId, liveMode: values.liveMode },
  });

  return access.store.id;
}

export async function disconnectMercadoPago(access: StoreAccess): Promise<void> {
  await db.delete(storePaymentAccounts).where(eq(storePaymentAccounts.storeId, access.store.id));
  await db.insert(auditLogs).values({
    accountId: access.account.id,
    storeId: access.store.id,
    actorUserId: access.userId,
    action: "payments.mercadopago_disconnected",
    entityType: "store",
    entityId: access.store.id,
  });
}

async function sellerCredentials(storeId: string): Promise<{ token: string; userId: string }> {
  const [account] = await db
    .select()
    .from(storePaymentAccounts)
    .where(eq(storePaymentAccounts.storeId, storeId))
    .limit(1);
  if (!account) {
    throw new AppError({
      statusCode: 409,
      code: "PAYMENT_METHOD_UNAVAILABLE",
      message: "This store has not connected Mercado Pago.",
    });
  }

  const expiresSoon =
    account.expiresAt && account.expiresAt.getTime() - Date.now() < REFRESH_MARGIN_MS;
  if (expiresSoon && account.refreshTokenEnc) {
    try {
      const refreshed = sealTokens(await refreshAccessToken(open(account.refreshTokenEnc)));
      await db
        .update(storePaymentAccounts)
        .set({ ...refreshed, updatedAt: new Date() })
        .where(eq(storePaymentAccounts.storeId, storeId));
      return { token: open(refreshed.accessTokenEnc), userId: refreshed.providerUserId };
    } catch (error) {
      // Keep using the current token while it is still valid.
      logger.warn({ err: error, storeId }, "Mercado Pago token refresh failed");
    }
  }

  return { token: open(account.accessTokenEnc), userId: account.providerUserId };
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

async function storeHost(storeId: string): Promise<string> {
  return (await storeHostname(storeId)) ?? "";
}

function customerOrderUrl(hostname: string, orderId: string): string {
  const scheme = env.APP_URL.startsWith("https") ? "https" : "http";
  return `${scheme}://${hostname}/pedido/${orderId}?token=${orderAccessToken(orderId)}&mp=1`;
}

/** Creates (or re-creates) the Mercado Pago checkout for a pending order. */
export async function createMercadoPagoCheckout(
  storeId: string,
  orderId: string,
): Promise<{ url: string }> {
  requireConfigured();
  const [row] = await db
    .select({ order: orders, storeName: stores.name })
    .from(orders)
    .innerJoin(stores, eq(stores.id, orders.storeId))
    .where(and(eq(orders.id, orderId), eq(orders.storeId, storeId)))
    .limit(1);
  if (row?.order.checkoutMethod !== "mercadopago") {
    throw new AppError({ statusCode: 404, code: "ORDER_NOT_FOUND", message: "Order not found." });
  }
  if (row.order.status !== "pending_payment") {
    throw new AppError({
      statusCode: 409,
      code: "ORDER_NOT_PENDING",
      message: "This order is not awaiting payment.",
    });
  }

  const { token } = await sellerCredentials(storeId);
  const back = customerOrderUrl(await storeHost(storeId), row.order.id);
  const preference = await createPreference(token, {
    items: [
      {
        id: row.order.id,
        title: `Fotos - pedido ${row.order.code} (${row.storeName})`.slice(0, 250),
        quantity: 1,
        currency_id: row.order.currency,
        unit_price: row.order.totalCents / 100,
      },
    ],
    payer: { name: row.order.customerName, email: row.order.customerEmail },
    external_reference: row.order.id,
    notification_url: mercadoPagoWebhookUrl(storeId),
    back_urls: { success: back, pending: back, failure: back },
    auto_return: "approved",
    ...(row.order.platformFeeCents > 0
      ? { marketplace_fee: row.order.platformFeeCents / 100 }
      : {}),
  });

  await db
    .update(orders)
    .set({ mpPreferenceId: preference.id, updatedAt: new Date() })
    .where(eq(orders.id, row.order.id));
  return { url: preference.init_point };
}

// ---------------------------------------------------------------------------
// Payment confirmation (webhook and on-return sync share this path)
// ---------------------------------------------------------------------------

async function applyMercadoPagoPayment(storeId: string, sellerUserId: string, payment: MpPayment) {
  const orderId = payment.external_reference ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return { applied: false, reason: "no_reference" };
  if (payment.collector_id !== undefined && String(payment.collector_id) !== sellerUserId) {
    logger.warn(
      { storeId, paymentId: payment.id },
      "Mercado Pago payment collected by another account",
    );
    return { applied: false, reason: "other_collector" };
  }
  if (payment.status !== "approved") {
    if (["refunded", "charged_back", "cancelled"].includes(payment.status)) {
      await db.insert(auditLogs).values({
        storeId,
        actorType: "mercadopago",
        action: "order.provider_payment_reversed",
        entityType: "order",
        entityId: orderId,
        after: { paymentId: String(payment.id), status: payment.status },
      });
    }
    return { applied: false, reason: payment.status };
  }

  const [order] = await db
    .select({ currency: orders.currency })
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.storeId, storeId)))
    .limit(1);
  if (!order) return { applied: false, reason: "unknown_order" };
  if (payment.currency_id !== order.currency) return { applied: false, reason: "currency" };

  const result = await db.transaction((tx) =>
    settleOrderPayment(
      tx,
      orderId,
      storeId,
      {
        amountCents: Math.round(payment.transaction_amount * 100),
        method: "mercadopago",
        reference: `Mercado Pago #${payment.id}`,
        providerPaymentId: `mp:${payment.id}`,
      },
      { kind: "provider", provider: "mercadopago" },
    ),
  );
  if (result.becamePaid) await notifyOrderPaid(result.order);
  return { applied: !result.duplicate, reason: result.isPaid ? "paid" : "partial" };
}

/** Pulls the order's payments from Mercado Pago (used when the buyer returns). */
export async function syncMercadoPagoOrder(storeId: string, orderId: string) {
  if (!mercadoPagoConfigured()) return;
  const { token, userId } = await sellerCredentials(storeId);
  const found = await searchPaymentsByReference(token, orderId);
  for (const payment of found) {
    await applyMercadoPagoPayment(storeId, userId, payment);
  }
}

export async function handleMercadoPagoWebhook(input: {
  storeId: string | undefined;
  dataId: string | undefined;
  type: string | undefined;
  topic?: string | undefined;
  signature: string | undefined;
  requestId: string | undefined;
}): Promise<{ status: number; result: string }> {
  if (!mercadoPagoConfigured()) return { status: 200, result: "disabled" };
  // Legacy IPN deliveries (?topic=...&id=...) arrive unsigned alongside the
  // signed webhook for the same event. Acknowledge them so Mercado Pago stops
  // retrying; the signed webhook (or the return sync) settles the payment.
  if (input.topic && !input.signature) return { status: 200, result: "ignored_ipn" };
  if (env.MP_WEBHOOK_SECRET && !verifyWebhookSignature(input)) {
    logger.warn(
      { storeId: input.storeId },
      "Rejected Mercado Pago webhook with an invalid signature",
    );
    return { status: 401, result: "invalid_signature" };
  }
  if (input.type && SUBSCRIPTION_WEBHOOK_TYPES.has(input.type)) {
    if (!input.dataId) return { status: 200, result: "ignored" };
    return { status: 200, result: await handleSubscriptionWebhook(input.type, input.dataId) };
  }
  if (input.type && input.type !== "payment") return { status: 200, result: "ignored_type" };
  if (!input.dataId || !input.storeId || !/^[0-9a-f-]{36}$/i.test(input.storeId)) {
    return { status: 200, result: "ignored" };
  }

  // Never trust the notification body: the payment is always read back from
  // Mercado Pago with the store's own credentials.
  let credentials: { token: string; userId: string };
  try {
    credentials = await sellerCredentials(input.storeId);
  } catch {
    return { status: 200, result: "store_not_connected" };
  }
  const payment = await getPayment(credentials.token, input.dataId);
  const outcome = await applyMercadoPagoPayment(input.storeId, credentials.userId, payment);
  return { status: 200, result: outcome.reason };
}
