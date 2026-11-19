import { and, asc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  albums,
  auditLogs,
  type CouponScope,
  orders,
  photos,
  storeCoupons,
} from "../../db/schema/index.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { StoreAccess } from "../stores/store-access.js";
import type { CreateCouponInput, UpdateCouponInput } from "./coupons.schemas.js";

type Coupon = typeof storeCoupons.$inferSelect;
type Executor = Pick<typeof db, "select">;

/** Unpaid orders keep a coupon use reserved for this long. */
const RESERVATION_HOURS = 24;

export type PricedLine = { kind: "photo" | "album"; priceCents: number };

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

/** Discount for the lines the coupon covers, rounded down so the total stays positive. */
export function couponDiscount(
  scope: CouponScope,
  percentOff: number,
  lines: PricedLine[],
): number {
  const eligible = lines
    .filter(
      (line) =>
        scope === "all" || (scope === "photos" ? line.kind === "photo" : line.kind === "album"),
    )
    .reduce((sum, line) => sum + line.priceCents, 0);
  return Math.floor((eligible * percentOff) / 100);
}

/** Paid orders plus unpaid ones still within the reservation window. */
export async function couponUses(executor: Executor, couponId: string): Promise<number> {
  const [row] = await executor
    .select({ count: sql<number>`count(*)::int` })
    .from(orders)
    .where(
      and(
        eq(orders.couponId, couponId),
        or(
          eq(orders.status, "paid"),
          and(
            eq(orders.status, "pending_payment"),
            gt(orders.createdAt, sql`now() - make_interval(hours => ${RESERVATION_HOURS})`),
          ),
        ),
      ),
    );
  return row?.count ?? 0;
}

function couponError(code: string, message: string, statusCode = 422): AppError {
  return new AppError({ statusCode, code, message });
}

/**
 * Validates a coupon for a store and returns the discount it gives on `lines`.
 * Pass a transaction and `lock` to serialize concurrent use of the same coupon.
 */
export async function applyCoupon(
  executor: Executor & { select: typeof db.select },
  storeId: string,
  rawCode: string,
  lines: PricedLine[],
  lock = false,
): Promise<{ coupon: Coupon; discountCents: number }> {
  const query = executor
    .select()
    .from(storeCoupons)
    .where(and(eq(storeCoupons.storeId, storeId), eq(storeCoupons.code, normalizeCode(rawCode))))
    .limit(1);
  const [coupon] = lock ? await query.for("update") : await query;
  const now = new Date();
  if (!coupon?.active) throw couponError("COUPON_NOT_FOUND", "Coupon not found.");
  if (coupon.startsAt && coupon.startsAt > now) {
    throw couponError("COUPON_NOT_STARTED", "Coupon is not valid yet.");
  }
  if (coupon.endsAt && coupon.endsAt <= now) throw couponError("COUPON_EXPIRED", "Coupon expired.");
  if (coupon.maxUses !== null && (await couponUses(executor, coupon.id)) >= coupon.maxUses) {
    throw couponError("COUPON_EXHAUSTED", "Coupon has no uses left.");
  }
  const discountCents = couponDiscount(coupon.appliesTo, coupon.percentOff, lines);
  if (discountCents <= 0) {
    throw couponError("COUPON_NOT_APPLICABLE", "Coupon does not apply to these items.");
  }
  return { coupon, discountCents };
}

/** Prices the public cart items (published, sellable) for a coupon check. */
export async function priceCartLines(
  storeId: string,
  items: Array<{ type: "photo" | "album"; id: string }>,
): Promise<PricedLine[]> {
  const albumIds = [...new Set(items.filter((i) => i.type === "album").map((i) => i.id))];
  const photoIds = [...new Set(items.filter((i) => i.type === "photo").map((i) => i.id))];
  const albumRows = albumIds.length
    ? await db
        .select({ id: albums.id, priceCents: albums.priceCents })
        .from(albums)
        .where(
          and(
            eq(albums.storeId, storeId),
            eq(albums.status, "published"),
            inArray(albums.id, albumIds),
          ),
        )
    : [];
  const coveredAlbums = new Set(albumRows.filter((a) => a.priceCents !== null).map((a) => a.id));
  const photoRows = photoIds.length
    ? await db
        .select({ id: photos.id, priceCents: photos.priceCents, albumId: photos.albumId })
        .from(photos)
        .where(
          and(
            eq(photos.storeId, storeId),
            eq(photos.status, "published"),
            inArray(photos.id, photoIds),
          ),
        )
    : [];
  return [
    ...albumRows
      .filter((a) => a.priceCents !== null)
      .map((a) => ({ kind: "album" as const, priceCents: a.priceCents ?? 0 })),
    ...photoRows
      .filter((p) => p.priceCents !== null && !(p.albumId && coveredAlbums.has(p.albumId)))
      .map((p) => ({ kind: "photo" as const, priceCents: p.priceCents ?? 0 })),
  ];
}

// --- Panel -------------------------------------------------------------------

function view(coupon: Coupon, uses: number) {
  const now = Date.now();
  const status = !coupon.active
    ? "paused"
    : coupon.endsAt && coupon.endsAt.getTime() <= now
      ? "expired"
      : coupon.maxUses !== null && uses >= coupon.maxUses
        ? "exhausted"
        : "active";
  return {
    id: coupon.id,
    code: coupon.code,
    percentOff: coupon.percentOff,
    appliesTo: coupon.appliesTo,
    maxUses: coupon.maxUses,
    endsAt: coupon.endsAt,
    active: coupon.active,
    showInStore: coupon.showInStore,
    uses,
    status,
    createdAt: coupon.createdAt,
  };
}

export async function listCoupons(access: StoreAccess) {
  const rows = await db
    .select()
    .from(storeCoupons)
    .where(eq(storeCoupons.storeId, access.store.id))
    .orderBy(asc(storeCoupons.createdAt));
  return Promise.all(rows.map(async (row) => view(row, await couponUses(db, row.id))));
}

export async function createCoupon(access: StoreAccess, input: CreateCouponInput) {
  const [existing] = await db
    .select({ id: storeCoupons.id })
    .from(storeCoupons)
    .where(and(eq(storeCoupons.storeId, access.store.id), eq(storeCoupons.code, input.code)))
    .limit(1);
  if (existing) throw couponError("COUPON_CODE_TAKEN", "That code already exists.", 409);
  const [coupon] = await db
    .insert(storeCoupons)
    .values({ storeId: access.store.id, ...input })
    .returning();
  if (!coupon) throw new Error("Coupon insert returned no row.");
  await db.insert(auditLogs).values({
    accountId: access.account.id,
    storeId: access.store.id,
    actorUserId: access.userId,
    action: "coupon.created",
    entityType: "store_coupon",
    entityId: coupon.id,
    after: { code: coupon.code, percentOff: coupon.percentOff },
  });
  return view(coupon, 0);
}

async function ownCoupon(access: StoreAccess, couponId: string): Promise<Coupon> {
  const [coupon] = await db
    .select()
    .from(storeCoupons)
    .where(and(eq(storeCoupons.id, couponId), eq(storeCoupons.storeId, access.store.id)))
    .limit(1);
  if (!coupon) throw couponError("COUPON_NOT_FOUND", "Coupon not found.", 404);
  return coupon;
}

export async function updateCoupon(
  access: StoreAccess,
  couponId: string,
  input: UpdateCouponInput,
) {
  await ownCoupon(access, couponId);
  const [coupon] = await db
    .update(storeCoupons)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(storeCoupons.id, couponId))
    .returning();
  if (!coupon) throw new Error("Coupon update returned no row.");
  return view(coupon, await couponUses(db, coupon.id));
}

/** Deletes an unused coupon; one that was used is paused instead (orders keep it). */
export async function deleteCoupon(access: StoreAccess, couponId: string) {
  await ownCoupon(access, couponId);
  const [used] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.couponId, couponId))
    .limit(1);
  if (used) {
    await db
      .update(storeCoupons)
      .set({ active: false, showInStore: false, updatedAt: new Date() })
      .where(eq(storeCoupons.id, couponId));
    return { deleted: false, paused: true };
  }
  await db.delete(storeCoupons).where(eq(storeCoupons.id, couponId));
  return { deleted: true, paused: false };
}

/** Active coupons the store chose to advertise. */
export async function storePromotions(storeId: string) {
  const rows = await db
    .select()
    .from(storeCoupons)
    .where(
      and(
        eq(storeCoupons.storeId, storeId),
        eq(storeCoupons.active, true),
        eq(storeCoupons.showInStore, true),
        or(isNull(storeCoupons.endsAt), gt(storeCoupons.endsAt, new Date())),
      ),
    )
    .orderBy(asc(storeCoupons.createdAt));
  const visible = [];
  for (const row of rows) {
    if (row.maxUses !== null && (await couponUses(db, row.id)) >= row.maxUses) continue;
    visible.push({
      code: row.code,
      percentOff: row.percentOff,
      appliesTo: row.appliesTo,
      endsAt: row.endsAt,
    });
  }
  return visible;
}
