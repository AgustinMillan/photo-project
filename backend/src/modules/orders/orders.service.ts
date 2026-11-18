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
import { mediaUrl, requirePublishedStoreByHost } from "../storefront/storefront.service.js";
import type { StoreAccess } from "../stores/store-access.js";
import { normalizeHostname } from "../stores/stores.constants.js";
import { resolveStoreByHostname } from "../stores/stores.service.js";
import type { CreateOrderInput, RecordPaymentInput } from "./orders.schemas.js";

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

async function storeHostname(storeId: string): Promise<string | null> {
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

    const [created] = await tx
      .insert(orders)
      .values({
        storeId: store.id,
        code: newOrderCode(),
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        totalCents,
        accessTokenHash: "pending",
        paymentInstructions: publication?.content.paymentInstructions ?? "",
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

  await notify(
    sendEmail({
      to: order.customerEmail,
      subject: `Tu pedido ${order.code} en ${store.name}`,
      text: [
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
      html: [
        `<p>Hola ${escapeHtml(order.customerName)},</p>`,
        `<p>Recibimos tu pedido <strong>${order.code}</strong> por <strong>${total}</strong>.</p>`,
        `<p><strong>Cómo pagar:</strong><br>${escapeHtml(order.paymentInstructions || "El fotógrafo te va a contactar con los datos de pago.").replace(/\n/g, "<br>")}</p>`,
        `<p>Cuando el pago se confirme, vas a poder descargar tus fotos desde <a href="${link}">este enlace</a>.</p>`,
      ].join(""),
    }),
  );
  await notifyOwner(store.id, order.code, order.customerName, total);

  return {
    orderId: order.id,
    code: order.code,
    accessToken: orderAccessToken(order.id),
    totalCents: order.totalCents,
    currency: order.currency,
    paymentInstructions: order.paymentInstructions,
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

async function requireCustomerOrder(rawHostname: string, orderId: string, token?: string) {
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
      createdAt: orders.createdAt,
      paidAt: orders.paidAt,
      paidCents: sql<number>`coalesce((select sum(amount_cents)::bigint from ${payments} p where p.order_id = ${orders.id}), 0)::float8`,
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
      photoCount: sql<number>`(select count(*)::int from ${orderItemPhotos} x where x.order_item_id = ${orderItems.id})`,
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
export async function recordPayment(
  access: StoreAccess,
  orderId: string,
  input: RecordPaymentInput,
) {
  const result = await db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.storeId, access.store.id)))
      .for("update")
      .limit(1);
    if (!order)
      throw new AppError({ statusCode: 404, code: "ORDER_NOT_FOUND", message: "Order not found." });
    if (order.status !== "pending_payment") {
      throw new AppError({
        statusCode: 409,
        code: "ORDER_NOT_PENDING",
        message: "Payments can only be recorded on pending orders.",
      });
    }

    const [payment] = await tx
      .insert(payments)
      .values({ orderId: order.id, ...input, recordedByUserId: access.userId })
      .returning();

    const [sum] = await tx
      .select({ total: sql<number>`coalesce(sum(${payments.amountCents}), 0)::float8` })
      .from(payments)
      .where(eq(payments.orderId, order.id));
    const paidCents = Number(sum?.total ?? 0);
    const isPaid = paidCents >= order.totalCents;
    const now = new Date();

    if (isPaid) {
      await tx
        .update(orders)
        .set({ status: "paid", paidAt: now, updatedAt: now })
        .where(eq(orders.id, order.id));
      const covered = await tx
        .select({ photoId: orderItemPhotos.photoId, versionId: orderItemPhotos.photoVersionId })
        .from(orderItemPhotos)
        .where(eq(orderItemPhotos.orderId, order.id));
      if (covered.length) {
        await tx.insert(orderEntitlements).values(
          covered.map((row) => ({
            orderId: order.id,
            storeId: order.storeId,
            photoId: row.photoId,
            photoVersionId: row.versionId,
          })),
        );
      }
    }

    await tx.insert(auditLogs).values({
      accountId: access.account.id,
      storeId: access.store.id,
      actorUserId: access.userId,
      action: isPaid ? "order.paid" : "order.payment_recorded",
      entityType: "order",
      entityId: order.id,
      after: {
        paymentId: payment?.id,
        amountCents: input.amountCents,
        method: input.method,
        paidCents,
      },
    });

    return { order, paidCents, isPaid };
  });

  if (result.isPaid) {
    const hostname = (await storeHostname(access.store.id)) ?? access.store.slug;
    const link = orderLink(hostname, result.order.id);
    await notify(
      sendEmail({
        to: result.order.customerEmail,
        subject: `Tus fotos del pedido ${result.order.code} están listas`,
        text: `Hola ${result.order.customerName},\n\nConfirmamos el pago de tu pedido ${result.order.code}. Ya podés descargar tus fotos en alta resolución:\n${link}\n\nGuardá este enlace: lo podés usar cuando quieras.`,
        html: `<p>Hola ${escapeHtml(result.order.customerName)},</p><p>Confirmamos el pago de tu pedido <strong>${result.order.code}</strong>. Ya podés <a href="${link}">descargar tus fotos en alta resolución</a>.</p><p>Guardá este enlace: lo podés usar cuando quieras.</p>`,
      }),
    );
  }

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
