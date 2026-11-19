import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { env } from "../../config/env.js";
import { db } from "../../db/client.js";
import {
  accounts,
  albums,
  auditLogs,
  downloadLogs,
  mediaAssets,
  type OrderStatus,
  orderEntitlements,
  orderItemPhotos,
  orderItems,
  orders,
  payments,
  photos,
  photoVersions,
  storePublications,
  stores,
} from "../../db/schema/index.js";
import { sendEmail } from "../../shared/email/email.service.js";
import { AppError } from "../../shared/errors/app-error.js";
import { logger } from "../../shared/logger.js";
import { assertStorePurchasesEnabled } from "../billing/billing.service.js";
import { originalPath } from "../catalog/media.js";
import { storePaymentOptions } from "../payments/payment-options.js";
import { mediaUrl, requirePublishedStoreByHost } from "../storefront/storefront.service.js";
import type { StoreAccess } from "../stores/store-access.js";
import { normalizeHostname } from "../stores/stores.constants.js";
import { resolveStoreByHostname } from "../stores/stores.service.js";
import type { CreateOrderInput, RecordPaymentInput } from "./orders.schemas.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Order links carry an HMAC of the order id. Nothing secret is stored, the link
 * can be re-sent at any time, and rotating JWT_ACCESS_SECRET invalidates them.
 */
export function orderAccessToken(orderId: string): string {
  return createHmac("sha256", `order-access:${env.JWT_ACCESS_SECRET}`)
    .update(orderId)
    .digest("base64url");
}

function tokenMatches(orderId: string, token: string | undefined): boolean {
  if (!token) return false;
  const expected = Buffer.from(orderAccessToken(orderId));
  const received = Buffer.from(token);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function newOrderCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  const chars = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

export function formatMoney(cents: number, currency = "ARS"): string {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency }).format(cents / 100);
}

function orderLink(hostname: string, orderId: string): string {
  const scheme = env.APP_URL.startsWith("https") ? "https" : "http";
  return `${scheme}://${hostname}/pedido/${orderId}?token=${orderAccessToken(orderId)}`;
}

function unavailable(ids: string[]): AppError {
  return new AppError({
    statusCode: 409,
    code: "ITEMS_UNAVAILABLE",
    message: "Some items are no longer available for purchase.",
    details: { ids },
  });
}

export async function storeHostname(storeId: string): Promise<string | null> {
  const rows = await db.execute<{ hostname: string }>(
    sql`select hostname from store_domains where store_id = ${storeId} and is_primary limit 1`,
  );
  return rows[0]?.hostname ?? null;
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

export async function createOrder(rawHostname: string, input: CreateOrderInput) {
  const store = await requirePublishedStoreByHost(rawHostname);
  if (env.DEMO_STORE_SLUGS.includes(store.slug.toLowerCase())) {
    throw new AppError({
      statusCode: 409,
      code: "STORE_IS_DEMO",
      message: "This is a showcase store; it does not take orders.",
    });
  }
  await assertStorePurchasesEnabled(store.id);

  const albumIds = [...new Set(input.items.filter((i) => i.type === "album").map((i) => i.id))];
  const photoIds = [...new Set(input.items.filter((i) => i.type === "photo").map((i) => i.id))];

  const order = await db.transaction(async (tx) => {
    const albumRows = albumIds.length
      ? await tx
          .select({ id: albums.id, title: albums.title, priceCents: albums.priceCents })
          .from(albums)
          .where(
            and(
              inArray(albums.id, albumIds),
              eq(albums.storeId, store.id),
              eq(albums.status, "published"),
            ),
          )
      : [];
    const sellableAlbums = albumRows.filter((album) => album.priceCents !== null);

    const albumPhotos = sellableAlbums.length
      ? await tx
          .select({ photoId: photos.id, albumId: photos.albumId, versionId: photoVersions.id })
          .from(photos)
          .innerJoin(
            photoVersions,
            and(eq(photoVersions.photoId, photos.id), eq(photoVersions.isCurrent, true)),
          )
          .where(
            and(
              inArray(
                photos.albumId,
                sellableAlbums.map((album) => album.id),
              ),
              eq(photos.storeId, store.id),
              eq(photos.status, "published"),
            ),
          )
      : [];

    const covered = new Set(albumPhotos.map((photo) => photo.photoId));
    const looseIds = photoIds.filter((id) => !covered.has(id));

    const photoRows = looseIds.length
      ? await tx
          .select({
            id: photos.id,
            title: photos.title,
            priceCents: photos.priceCents,
            versionId: photoVersions.id,
          })
          .from(photos)
          .innerJoin(
            photoVersions,
            and(eq(photoVersions.photoId, photos.id), eq(photoVersions.isCurrent, true)),
          )
          .where(
            and(
              inArray(photos.id, looseIds),
              eq(photos.storeId, store.id),
              eq(photos.status, "published"),
            ),
          )
      : [];
    const sellablePhotos = photoRows.filter((photo) => photo.priceCents !== null);

    const missing = [
      ...albumIds.filter((id) => !sellableAlbums.some((album) => album.id === id)),
      ...looseIds.filter((id) => !sellablePhotos.some((photo) => photo.id === id)),
    ];
    const emptyAlbums = sellableAlbums.filter(
      (album) => !albumPhotos.some((photo) => photo.albumId === album.id),
    );
    if (missing.length || emptyAlbums.length) {
      throw unavailable([...missing, ...emptyAlbums.map((album) => album.id)]);
    }

    const totalCents =
      sellableAlbums.reduce((sum, album) => sum + (album.priceCents ?? 0), 0) +
      sellablePhotos.reduce((sum, photo) => sum + (photo.priceCents ?? 0), 0);

    const [publication] = await tx
      .select({ content: storePublications.content })
      .from(storePublications)
      .where(eq(storePublications.storeId, store.id))
      .orderBy(desc(storePublications.version))
      .limit(1);

    const paymentInstructions = publication?.content.paymentInstructions ?? "";
    const options = await storePaymentOptions(store.id, paymentInstructions);
    if (!options[input.paymentMethod]) {
      throw new AppError({
        statusCode: 409,
        code: "PAYMENT_METHOD_UNAVAILABLE",
        message: "This store does not accept that payment method.",
        details: { options },
      });
    }
    const platformFeeCents =
      input.paymentMethod === "mercadopago"
        ? Math.min(Math.round((totalCents * env.PLATFORM_FEE_PERCENT) / 100), totalCents)
        : 0;

    const [created] = await tx
      .insert(orders)
      .values({
        storeId: store.id,
        code: newOrderCode(),
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        totalCents,
        accessTokenHash: "pending",
        paymentInstructions: input.paymentMethod === "transfer" ? paymentInstructions : "",
        checkoutMethod: input.paymentMethod,
        platformFeeCents,
      })
      .returning();
    if (!created) throw new Error("Order insert returned no row.");

    const token = orderAccessToken(created.id);
    await tx
      .update(orders)
      .set({ accessTokenHash: createHash("sha256").update(token).digest("hex") })
      .where(eq(orders.id, created.id));

    for (const album of sellableAlbums) {
      const [item] = await tx
        .insert(orderItems)
        .values({
          orderId: created.id,
          kind: "album",
          albumId: album.id,
          titleSnapshot: album.title,
          priceCents: album.priceCents ?? 0,
        })
        .returning({ id: orderItems.id });
      const covers = albumPhotos.filter((photo) => photo.albumId === album.id);
      await tx.insert(orderItemPhotos).values(
        covers.map((photo) => ({
          orderItemId: item?.id ?? "",
          orderId: created.id,
          photoId: photo.photoId,
          photoVersionId: photo.versionId,
        })),
      );
    }

    for (const photo of sellablePhotos) {
      const [item] = await tx
        .insert(orderItems)
        .values({
          orderId: created.id,
          kind: "photo",
          photoId: photo.id,
          titleSnapshot: photo.title || "Fotografía",
          priceCents: photo.priceCents ?? 0,
        })
        .returning({ id: orderItems.id });
      await tx.insert(orderItemPhotos).values({
        orderItemId: item?.id ?? "",
        orderId: created.id,
        photoId: photo.id,
        photoVersionId: photo.versionId,
      });
    }

    await tx.insert(auditLogs).values({
      storeId: store.id,
      actorType: "customer",
      action: "order.created",
      entityType: "order",
      entityId: created.id,
      after: { code: created.code, totalCents, items: albumIds.length + sellablePhotos.length },
    });

    return created;
  });

  const hostname = normalizeHostname(rawHostname);
  const link = orderLink(hostname, order.id);
  const total = formatMoney(order.totalCents, order.currency);

  // Emails go out in the background so the customer is not kept waiting on SMTP.
  void notify(
    sendEmail({
      to: order.customerEmail,
      subject: `Tu pedido ${order.code} en ${store.name}`,
      text:
        order.checkoutMethod === "mercadopago"
          ? [
              `Hola ${order.customerName},`,
              "",
              `Recibimos tu pedido ${order.code} por ${total}.`,
              "Si todavía no completaste el pago con Mercado Pago, podés hacerlo desde este enlace. Apenas se apruebe, ahí mismo vas a poder descargar tus fotos:",
              link,
            ].join("\n")
          : [
              `Hola ${order.customerName},`,
              "",
              `Recibimos tu pedido ${order.code} por ${total}.`,
              "",
              "Cómo pagar:",
              order.paymentInstructions || "El fotógrafo te va a contactar con los datos de pago.",
              "",
              "Cuando el pago se confirme, vas a poder descargar tus fotos desde este enlace:",
              link,
            ].join("\n"),
      html:
        order.checkoutMethod === "mercadopago"
          ? [
              `<p>Hola ${escapeHtml(order.customerName)},</p>`,
              `<p>Recibimos tu pedido <strong>${order.code}</strong> por <strong>${total}</strong>.</p>`,
              `<p>Si todavía no completaste el pago con Mercado Pago, podés hacerlo desde <a href="${link}">este enlace</a>. Apenas se apruebe, ahí mismo vas a poder descargar tus fotos.</p>`,
            ].join("")
          : [
              `<p>Hola ${escapeHtml(order.customerName)},</p>`,
              `<p>Recibimos tu pedido <strong>${order.code}</strong> por <strong>${total}</strong>.</p>`,
              `<p><strong>Cómo pagar:</strong><br>${escapeHtml(order.paymentInstructions || "El fotógrafo te va a contactar con los datos de pago.").replace(/\n/g, "<br>")}</p>`,
              `<p>Cuando el pago se confirme, vas a poder descargar tus fotos desde <a href="${link}">este enlace</a>.</p>`,
            ].join(""),
    }),
  );
  void notifyOwner(store.id, order.code, order.customerName, total).catch((error: unknown) =>
    logger.error({ err: error }, "Failed to notify store owner"),
  );

  return {
    orderId: order.id,
    code: order.code,
    accessToken: orderAccessToken(order.id),
    totalCents: order.totalCents,
    currency: order.currency,
    paymentInstructions: order.paymentInstructions,
    paymentMethod: order.checkoutMethod,
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[<>&"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

async function notify(promise: Promise<void>): Promise<void> {
  try {
    await promise;
  } catch (error) {
    // The order exists either way; the photographer can re-send the link.
    logger.error({ err: error }, "Failed to send order email");
  }
}

async function notifyOwner(storeId: string, code: string, customer: string, total: string) {
  const [owner] = await db
    .select({ email: accounts.billingEmail, storeName: stores.name })
    .from(stores)
    .innerJoin(accounts, eq(accounts.id, stores.accountId))
    .where(eq(stores.id, storeId));
  if (!owner) return;
  const panel = new URL("/app/orders", env.APP_URL).toString();
  await notify(
    sendEmail({
      to: owner.email,
      subject: `Nuevo pedido ${code} (${total})`,
      text: `${customer} hizo el pedido ${code} por ${total} en ${owner.storeName}.\n\nCuando recibas el pago, registralo en ${panel} para habilitar las descargas.`,
      html: `<p>${escapeHtml(customer)} hizo el pedido <strong>${code}</strong> por <strong>${total}</strong> en ${escapeHtml(owner.storeName)}.</p><p>Cuando recibas el pago, <a href="${panel}">registralo en el panel</a> para habilitar las descargas.</p>`,
    }),
  );
}

// ---------------------------------------------------------------------------
// Customer access (no account: the signed link is the credential)
// ---------------------------------------------------------------------------

export async function requireCustomerOrder(rawHostname: string, orderId: string, token?: string) {
  // Rights survive unpublishing or suspending the store, so only the hostname
  // mapping is required here, not an active storefront.
  const store = await resolveStoreByHostname(normalizeHostname(rawHostname));
  const [order] = store
    ? await db
        .select()
        .from(orders)
        .where(and(eq(orders.id, orderId), eq(orders.storeId, store.id)))
        .limit(1)
    : [];

  if (!store || !order || !tokenMatches(order.id, token)) {
    throw new AppError({ statusCode: 404, code: "ORDER_NOT_FOUND", message: "Order not found." });
  }
  return { store, order };
}

export async function getCustomerOrder(rawHostname: string, orderId: string, token?: string) {
  const { store, order } = await requireCustomerOrder(rawHostname, orderId, token);
  const items = await db
    .select({
      kind: orderItems.kind,
      title: orderItems.titleSnapshot,
      priceCents: orderItems.priceCents,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id))
    .orderBy(asc(orderItems.createdAt));

  const downloads =
    order.status === "paid"
      ? await db
          .select({
            photoId: orderEntitlements.photoId,
            title: photos.title,
            assetId: photoVersions.mediaAssetId,
          })
          .from(orderEntitlements)
          .innerJoin(photos, eq(photos.id, orderEntitlements.photoId))
          .innerJoin(photoVersions, eq(photoVersions.id, orderEntitlements.photoVersionId))
          .where(and(eq(orderEntitlements.orderId, order.id), isNull(orderEntitlements.revokedAt)))
          .orderBy(asc(photos.sortOrder), asc(photos.createdAt))
      : [];

  return {
    store: { name: store.name },
    order: {
      id: order.id,
      code: order.code,
      status: order.status,
      customerName: order.customerName,
      totalCents: order.totalCents,
      currency: order.currency,
      paymentInstructions: order.status === "pending_payment" ? order.paymentInstructions : "",
      paymentMethod: order.checkoutMethod,
      createdAt: order.createdAt,
      paidAt: order.paidAt,
    },
    items,
    downloads: downloads.map((download) => ({
      photoId: download.photoId,
      title: download.title,
      thumbUrl: mediaUrl(download.assetId, "thumb"),
    })),
  };
}

export async function authorizeDownload(
  rawHostname: string,
  orderId: string,
  photoId: string,
  token: string | undefined,
  meta: { ip?: string; userAgent?: string },
) {
  const { order } = await requireCustomerOrder(rawHostname, orderId, token);

  const [row] =
    order.status === "paid"
      ? await db
          .select({
            entitlementId: orderEntitlements.id,
            originalKey: mediaAssets.originalKey,
            mimeType: mediaAssets.mimeType,
            filename: mediaAssets.originalFilename,
            bytes: mediaAssets.bytes,
          })
          .from(orderEntitlements)
          .innerJoin(photoVersions, eq(photoVersions.id, orderEntitlements.photoVersionId))
          .innerJoin(mediaAssets, eq(mediaAssets.id, photoVersions.mediaAssetId))
          .where(
            and(
              eq(orderEntitlements.orderId, order.id),
              eq(orderEntitlements.photoId, photoId),
              eq(orderEntitlements.storeId, order.storeId),
              isNull(orderEntitlements.revokedAt),
            ),
          )
          .limit(1)
      : [];

  if (!row) {
    throw new AppError({
      statusCode: 403,
      code: "DOWNLOAD_NOT_ALLOWED",
      message: "This photo is not available for download in this order.",
    });
  }

  await db.insert(downloadLogs).values({
    entitlementId: row.entitlementId,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent?.slice(0, 512) ?? null,
  });

  return {
    path: originalPath(row.originalKey),
    mimeType: row.mimeType,
    filename: row.filename,
    bytes: row.bytes,
  };
}

// ---------------------------------------------------------------------------
// Photographer side
// ---------------------------------------------------------------------------

export async function listStoreOrders(access: StoreAccess, status?: OrderStatus) {
  return db
    .select({
      id: orders.id,
      code: orders.code,
      customerName: orders.customerName,
      customerEmail: orders.customerEmail,
      status: orders.status,
      totalCents: orders.totalCents,
      currency: orders.currency,
      checkoutMethod: orders.checkoutMethod,
      createdAt: orders.createdAt,
      paidAt: orders.paidAt,
      paidCents: sql<number>`coalesce((select sum(amount_cents)::bigint from ${payments} p where p.order_id = "orders"."id"), 0)::float8`,
    })
    .from(orders)
    .where(and(eq(orders.storeId, access.store.id), status ? eq(orders.status, status) : undefined))
    .orderBy(desc(orders.createdAt))
    .limit(500);
}

async function requireStoreOrder(access: StoreAccess, orderId: string) {
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.storeId, access.store.id)))
    .limit(1);
  if (!order)
    throw new AppError({ statusCode: 404, code: "ORDER_NOT_FOUND", message: "Order not found." });
  return order;
}

export async function getStoreOrder(access: StoreAccess, orderId: string) {
  const order = await requireStoreOrder(access, orderId);
  const items = await db
    .select({
      id: orderItems.id,
      kind: orderItems.kind,
      title: orderItems.titleSnapshot,
      priceCents: orderItems.priceCents,
      photoCount: sql<number>`(select count(*)::int from ${orderItemPhotos} x where x.order_item_id = "order_items"."id")`,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id))
    .orderBy(asc(orderItems.createdAt));
  const paymentRows = await db
    .select()
    .from(payments)
    .where(eq(payments.orderId, order.id))
    .orderBy(asc(payments.createdAt));
  const [downloads] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(downloadLogs)
    .innerJoin(orderEntitlements, eq(orderEntitlements.id, downloadLogs.entitlementId))
    .where(eq(orderEntitlements.orderId, order.id));

  const { accessTokenHash: _hash, ...view } = order;
  return {
    order: view,
    items,
    payments: paymentRows,
    paidCents: paymentRows.reduce((sum, payment) => sum + payment.amountCents, 0),
    downloadCount: downloads?.count ?? 0,
  };
}

/**
 * Records money received outside the platform. The order becomes paid only
 * when the recorded payments cover the total; only then are download rights
 * granted, for the exact photo versions frozen at checkout.
 */
type PaymentValues = {
  amountCents: number;
  method: "transfer" | "cash" | "other" | "mercadopago";
  reference: string;
  providerPaymentId?: string | null;
};

type SettleActor =
  | { kind: "user"; userId: string; accountId: string }
  | { kind: "provider"; provider: "mercadopago" };

export type SettleResult = {
  order: typeof orders.$inferSelect;
  paidCents: number;
  isPaid: boolean;
  becamePaid: boolean;
  duplicate: boolean;
};

/**
 * Single path for every payment (manual or Mercado Pago). Runs inside the
 * caller's transaction with the order row locked. Download rights are created
 * exactly once, when recorded payments first cover the total.
 */
export async function settleOrderPayment(
  tx: Tx,
  orderId: string,
  storeId: string,
  values: PaymentValues,
  actor: SettleActor,
): Promise<SettleResult> {
  const [order] = await tx
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.storeId, storeId)))
    .for("update")
    .limit(1);
  if (!order) {
    throw new AppError({ statusCode: 404, code: "ORDER_NOT_FOUND", message: "Order not found." });
  }

  // A customer may pay through Mercado Pago after the order was cancelled; the
  // money is real, so provider payments still settle it. Manual payments do not.
  const acceptsPayment =
    order.status === "pending_payment" ||
    (order.status === "cancelled" && actor.kind === "provider");

  if (order.status === "paid" && actor.kind === "provider") {
    return { order, paidCents: order.totalCents, isPaid: true, becamePaid: false, duplicate: true };
  }
  if (!acceptsPayment) {
    throw new AppError({
      statusCode: 409,
      code: "ORDER_NOT_PENDING",
      message: "Payments can only be recorded on pending orders.",
    });
  }

  const inserted = await tx
    .insert(payments)
    .values({
      orderId: order.id,
      amountCents: values.amountCents,
      method: values.method,
      reference: values.reference,
      providerPaymentId: values.providerPaymentId ?? null,
      recordedByUserId: actor.kind === "user" ? actor.userId : null,
    })
    .onConflictDoNothing()
    .returning({ id: payments.id });
  const duplicate = inserted.length === 0;

  const [sum] = await tx
    .select({ total: sql<number>`coalesce(sum(${payments.amountCents}), 0)::float8` })
    .from(payments)
    .where(eq(payments.orderId, order.id));
  const paidCents = Number(sum?.total ?? 0);
  const isPaid = paidCents >= order.totalCents;
  const now = new Date();

  if (isPaid && !duplicate) {
    await tx
      .update(orders)
      .set({ status: "paid", paidAt: now, cancelledAt: null, updatedAt: now })
      .where(eq(orders.id, order.id));
    const covered = await tx
      .select({ photoId: orderItemPhotos.photoId, versionId: orderItemPhotos.photoVersionId })
      .from(orderItemPhotos)
      .where(eq(orderItemPhotos.orderId, order.id));
    if (covered.length) {
      await tx
        .insert(orderEntitlements)
        .values(
          covered.map((row) => ({
            orderId: order.id,
            storeId: order.storeId,
            photoId: row.photoId,
            photoVersionId: row.versionId,
          })),
        )
        .onConflictDoNothing();
    }
  }

  if (!duplicate) {
    await tx.insert(auditLogs).values({
      accountId: actor.kind === "user" ? actor.accountId : null,
      storeId: order.storeId,
      actorUserId: actor.kind === "user" ? actor.userId : null,
      actorType: actor.kind === "user" ? "user" : actor.provider,
      action: isPaid ? "order.paid" : "order.payment_recorded",
      entityType: "order",
      entityId: order.id,
      after: {
        paymentId: inserted[0]?.id,
        amountCents: values.amountCents,
        method: values.method,
        providerPaymentId: values.providerPaymentId ?? null,
        paidCents,
      },
    });
  }

  return { order, paidCents, isPaid, becamePaid: isPaid && !duplicate, duplicate };
}

/** Emails the customer the download link once an order becomes paid. */
export async function notifyOrderPaid(order: typeof orders.$inferSelect): Promise<void> {
  const [store] = await db
    .select({ slug: stores.slug })
    .from(stores)
    .where(eq(stores.id, order.storeId))
    .limit(1);
  const hostname = (await storeHostname(order.storeId)) ?? store?.slug ?? "";
  const link = orderLink(hostname, order.id);
  void notify(
    sendEmail({
      to: order.customerEmail,
      subject: `Tus fotos del pedido ${order.code} están listas`,
      text: `Hola ${order.customerName},\n\nConfirmamos el pago de tu pedido ${order.code}. Ya podés descargar tus fotos en alta resolución:\n${link}\n\nGuardá este enlace: lo podés usar cuando quieras.`,
      html: `<p>Hola ${escapeHtml(order.customerName)},</p><p>Confirmamos el pago de tu pedido <strong>${order.code}</strong>. Ya podés <a href="${link}">descargar tus fotos en alta resolución</a>.</p><p>Guardá este enlace: lo podés usar cuando quieras.</p>`,
    }),
  );
}

/**
 * Records money received outside the platform (transfer, cash). The order
 * becomes paid only when recorded payments cover the total.
 */
export async function recordPayment(
  access: StoreAccess,
  orderId: string,
  input: RecordPaymentInput,
) {
  const result = await db.transaction((tx) =>
    settleOrderPayment(tx, orderId, access.store.id, input, {
      kind: "user",
      userId: access.userId,
      accountId: access.account.id,
    }),
  );

  if (result.becamePaid) await notifyOrderPaid(result.order);

  return {
    status: result.isPaid ? ("paid" as const) : ("pending_payment" as const),
    paidCents: result.paidCents,
    remainingCents: Math.max(result.order.totalCents - result.paidCents, 0),
  };
}

export async function cancelOrder(access: StoreAccess, orderId: string) {
  const order = await requireStoreOrder(access, orderId);
  if (order.status !== "pending_payment") {
    throw new AppError({
      statusCode: 409,
      code: "ORDER_NOT_PENDING",
      message: "Only pending orders can be cancelled.",
    });
  }
  const now = new Date();
  await db
    .update(orders)
    .set({ status: "cancelled", cancelledAt: now, updatedAt: now })
    .where(eq(orders.id, order.id));
  await db.insert(auditLogs).values({
    accountId: access.account.id,
    storeId: access.store.id,
    actorUserId: access.userId,
    action: "order.cancelled",
    entityType: "order",
    entityId: order.id,
  });
  return { status: "cancelled" as const };
}

export async function orderCustomerLink(access: StoreAccess, orderId: string) {
  const order = await requireStoreOrder(access, orderId);
  const hostname = (await storeHostname(access.store.id)) ?? access.store.slug;
  return { link: orderLink(hostname, order.id) };
}
