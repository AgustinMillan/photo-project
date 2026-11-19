import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { env } from "../../config/env.js";
import { db } from "../../db/client.js";
import { pageVisits } from "../../db/schema/index.js";
import { mediaUrl } from "../storefront/storefront.service.js";
import { normalizeHostname } from "../stores/stores.constants.js";
import { resolveStoreByHostname } from "../stores/stores.service.js";

const TIME_ZONE = "America/Argentina/Buenos_Aires";
const BOT_PATTERN =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|curl|wget|python|headless|lighthouse|monitor/i;

/** Calendar day in Argentina, as YYYY-MM-DD. */
export function localDay(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(date);
}

/**
 * Daily, salted, one-way visitor id. The salt changes every day, so the same
 * person cannot be followed across days and the IP is never stored.
 */
export function visitorHash(day: string, ip: string, userAgent: string): string {
  return createHash("sha256")
    .update(`${env.JWT_ACCESS_SECRET}|visits|${day}|${ip}|${userAgent}`)
    .digest("base64url")
    .slice(0, 22);
}

export async function resolveVisitScope(hostname: string): Promise<string | null> {
  const host = normalizeHostname(hostname);
  const platform = env.PLATFORM_DOMAIN.trim().toLowerCase().replace(/\.$/, "");
  if (host === platform || host === `www.${platform}`) return "landing";
  const store = await resolveStoreByHostname(host);
  return store ? `store:${store.id}` : null;
}

export async function recordVisit(input: {
  hostname: string;
  ip: string;
  userAgent: string | undefined;
}): Promise<boolean> {
  const userAgent = input.userAgent ?? "";
  if (!userAgent || BOT_PATTERN.test(userAgent)) return false;
  const scope = await resolveVisitScope(input.hostname);
  if (!scope) return false;
  const day = localDay();
  await db
    .insert(pageVisits)
    .values({ day, scope, visitorHash: visitorHash(day, input.ip, userAgent), views: 1 })
    .onConflictDoUpdate({
      target: [pageVisits.day, pageVisits.scope, pageVisits.visitorHash],
      set: { views: sql`${pageVisits.views} + 1` },
    });
  return true;
}

export type DailyPoint = {
  day: string;
  visitors: number;
  views: number;
  orders: number;
  revenueCents: number;
};

export type StoreStats = {
  days: number;
  from: string;
  to: string;
  currency: string;
  totals: {
    visitors: number;
    views: number;
    orders: number;
    revenueCents: number;
    averageOrderCents: number;
    conversionRate: number | null;
  };
  previous: { visitors: number; orders: number; revenueCents: number };
  series: DailyPoint[];
  topPhotos: {
    id: string;
    title: string;
    thumbUrl: string | null;
    sales: number;
    revenueCents: number;
  }[];
  topAlbums: { id: string; title: string; sales: number; revenueCents: number }[];
  paymentMethods: { method: string; orders: number }[];
};

function shiftDay(day: string, delta: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

type Row = Record<string, unknown>;
const num = (value: unknown) => Number(value ?? 0);

export async function getStoreStats(storeId: string, days: number): Promise<StoreStats> {
  const to = localDay();
  const from = shiftDay(to, -(days - 1));
  const prevFrom = shiftDay(from, -days);
  const scope = `store:${storeId}`;

  const visits = (await db.execute(sql`
    select day::text as day, count(*)::int as visitors, coalesce(sum(views), 0)::int as views
    from page_visits
    where scope = ${scope} and day between ${from}::date and ${to}::date
    group by day`)) as unknown as Row[];

  const orders = (await db.execute(sql`
    select (paid_at at time zone ${TIME_ZONE})::date::text as day,
           count(*)::int as orders, coalesce(sum(total_cents), 0)::bigint as revenue
    from orders
    where store_id = ${storeId} and status = 'paid'
      and (paid_at at time zone ${TIME_ZONE})::date between ${from}::date and ${to}::date
    group by 1`)) as unknown as Row[];

  const [previous] = (await db.execute(sql`
    select
      (select count(*) from page_visits
        where scope = ${scope} and day between ${prevFrom}::date and ${shiftDay(from, -1)}::date)::int as visitors,
      (select count(*) from orders where store_id = ${storeId} and status = 'paid'
        and (paid_at at time zone ${TIME_ZONE})::date between ${prevFrom}::date and ${shiftDay(from, -1)}::date)::int as orders,
      (select coalesce(sum(total_cents), 0) from orders where store_id = ${storeId} and status = 'paid'
        and (paid_at at time zone ${TIME_ZONE})::date between ${prevFrom}::date and ${shiftDay(from, -1)}::date)::bigint as revenue
  `)) as unknown as Row[];

  const topPhotos = (await db.execute(sql`
    select p.id, p.title, pv.media_asset_id as asset_id,
           count(*)::int as sales, coalesce(sum(oi.price_cents), 0)::bigint as revenue
    from order_items oi
    join orders o on o.id = oi.order_id
    join photos p on p.id = oi.photo_id
    left join photo_versions pv on pv.photo_id = p.id and pv.is_current
    where o.store_id = ${storeId} and o.status = 'paid' and oi.kind = 'photo'
      and (o.paid_at at time zone ${TIME_ZONE})::date between ${from}::date and ${to}::date
    group by p.id, p.title, pv.media_asset_id
    order by sales desc, revenue desc
    limit 5`)) as unknown as Row[];

  const topAlbums = (await db.execute(sql`
    select a.id, a.title, count(*)::int as sales, coalesce(sum(oi.price_cents), 0)::bigint as revenue
    from order_items oi
    join orders o on o.id = oi.order_id
    join albums a on a.id = coalesce(oi.album_id, (select ph.album_id from photos ph where ph.id = oi.photo_id))
    where o.store_id = ${storeId} and o.status = 'paid'
      and (o.paid_at at time zone ${TIME_ZONE})::date between ${from}::date and ${to}::date
    group by a.id, a.title
    order by revenue desc, sales desc
    limit 5`)) as unknown as Row[];

  const methods = (await db.execute(sql`
    select checkout_method as method, count(*)::int as orders
    from orders
    where store_id = ${storeId} and status = 'paid'
      and (paid_at at time zone ${TIME_ZONE})::date between ${from}::date and ${to}::date
    group by 1 order by 2 desc`)) as unknown as Row[];

  const visitsByDay = new Map(visits.map((row) => [String(row.day), row]));
  const ordersByDay = new Map(orders.map((row) => [String(row.day), row]));
  const series: DailyPoint[] = [];
  for (let i = 0; i < days; i += 1) {
    const day = shiftDay(from, i);
    const v = visitsByDay.get(day);
    const o = ordersByDay.get(day);
    series.push({
      day,
      visitors: num(v?.visitors),
      views: num(v?.views),
      orders: num(o?.orders),
      revenueCents: num(o?.revenue),
    });
  }

  const totals = series.reduce(
    (acc, point) => ({
      visitors: acc.visitors + point.visitors,
      views: acc.views + point.views,
      orders: acc.orders + point.orders,
      revenueCents: acc.revenueCents + point.revenueCents,
    }),
    { visitors: 0, views: 0, orders: 0, revenueCents: 0 },
  );

  return {
    days,
    from,
    to,
    currency: "ARS",
    totals: {
      ...totals,
      averageOrderCents: totals.orders ? Math.round(totals.revenueCents / totals.orders) : 0,
      conversionRate: totals.visitors ? totals.orders / totals.visitors : null,
    },
    previous: {
      visitors: num(previous?.visitors),
      orders: num(previous?.orders),
      revenueCents: num(previous?.revenue),
    },
    series,
    topPhotos: topPhotos.map((row) => ({
      id: String(row.id),
      title: String(row.title ?? ""),
      thumbUrl: row.asset_id ? mediaUrl(String(row.asset_id), "thumb") : null,
      sales: num(row.sales),
      revenueCents: num(row.revenue),
    })),
    topAlbums: topAlbums.map((row) => ({
      id: String(row.id),
      title: String(row.title ?? ""),
      sales: num(row.sales),
      revenueCents: num(row.revenue),
    })),
    paymentMethods: methods.map((row) => ({ method: String(row.method), orders: num(row.orders) })),
  };
}
