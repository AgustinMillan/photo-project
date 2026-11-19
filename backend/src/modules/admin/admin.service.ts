import { sql } from "drizzle-orm";
import { env } from "../../config/env.js";
import { db } from "../../db/client.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { AuthUser } from "../auth/auth.service.js";

/** Platform-wide read models for the founder's dashboard. Read-only SQL. */

export function isPlatformAdmin(user: AuthUser): boolean {
  return (
    user.status === "active" &&
    user.emailVerifiedAt !== null &&
    env.PLATFORM_ADMIN_EMAILS.includes(user.email.toLowerCase())
  );
}

export function assertPlatformAdmin(user: AuthUser): void {
  if (!isPlatformAdmin(user)) {
    // 404 so the admin area does not advertise itself.
    throw new AppError({ statusCode: 404, code: "NOT_FOUND", message: "Not found." });
  }
}

// Subscription status as the product sees it (expiry is applied lazily elsewhere).
const EFFECTIVE_STATUS = sql.raw(`
  case
    when s.id is null then 'none'
    when s.is_pilot then 'pilot'
    when s.status = 'trial' and s.trial_ends_at <= now() then 'expired'
    when s.status = 'active' and s.current_period_end <= now() then 'expired'
    else s.status
  end`);

type Row = Record<string, unknown>;

function num(value: unknown): number {
  return value === null || value === undefined ? 0 : Number(value);
}

export async function getOverview(days: number) {
  const [totals] = await db.execute<Row>(sql`
    select
      (select count(*) from users where status <> 'deleted') as users,
      (select count(*) from users where email_verified_at is not null) as verified_users,
      (select count(*) from accounts where deleted_at is null) as accounts,
      (select count(*) from stores where deleted_at is null) as stores,
      (select count(*) from stores where deleted_at is null and publication_status = 'published') as published_stores,
      (select count(*) from store_payment_accounts) as mercadopago_connected,
      (select count(*) from photos where status <> 'archived') as photos,
      (select coalesce(sum(bytes), 0) from media_assets) as storage_bytes,
      (select count(*) from orders) as orders,
      (select count(*) from orders where status = 'paid') as paid_orders,
      (select count(*) from orders where status = 'pending_payment') as pending_orders,
      (select coalesce(sum(total_cents), 0) from orders where status = 'paid') as gmv_cents,
      (select coalesce(sum(total_cents), 0) from orders where status = 'paid' and paid_at >= now() - make_interval(days => ${days})) as gmv_period_cents,
      (select coalesce(sum(platform_fee_cents), 0) from orders where status = 'paid') as platform_fees_cents,
      (select count(*) from orders where status = 'paid' and checkout_method = 'mercadopago') as paid_mercadopago,
      (select count(*) from download_logs) as downloads,
      (select count(*) from users where created_at >= now() - make_interval(days => ${days})) as signups_period
  `);

  const subscriptionRows = await db.execute<Row>(sql`
    select ${EFFECTIVE_STATUS} as status, coalesce(p.code, '-') as plan, count(*) as count
    from accounts a
    left join subscriptions s on s.account_id = a.id and s.ended_at is null
    left join plans p on p.id = s.plan_id
    where a.deleted_at is null
    group by 1, 2
    order by 1, 2
  `);

  const [expiring] = await db.execute<Row>(sql`
    select count(*) as count from subscriptions s
    where s.ended_at is null and not s.is_pilot and (
      (s.status = 'trial' and s.trial_ends_at > now() and s.trial_ends_at <= now() + interval '7 days') or
      (s.status = 'active' and s.current_period_end > now() and s.current_period_end <= now() + interval '7 days')
    )
  `);

  const series = await db.execute<Row>(sql`
    with day as (
      select generate_series(
        (now() at time zone 'America/Argentina/Buenos_Aires')::date - (${days}::int - 1),
        (now() at time zone 'America/Argentina/Buenos_Aires')::date,
        interval '1 day'
      )::date as d
    )
    select
      to_char(day.d, 'YYYY-MM-DD') as date,
      (select count(*) from users u where (u.created_at at time zone 'America/Argentina/Buenos_Aires')::date = day.d) as signups,
      (select count(*) from orders o where (o.created_at at time zone 'America/Argentina/Buenos_Aires')::date = day.d) as orders,
      (select count(*) from orders o where o.status = 'paid' and (o.paid_at at time zone 'America/Argentina/Buenos_Aires')::date = day.d) as paid_orders,
      (select coalesce(sum(total_cents), 0) from orders o where o.status = 'paid' and (o.paid_at at time zone 'America/Argentina/Buenos_Aires')::date = day.d) as gmv_cents
    from day
    order by day.d
  `);

  const t = totals ?? {};
  return {
    days,
    totals: {
      users: num(t.users),
      verifiedUsers: num(t.verified_users),
      accounts: num(t.accounts),
      stores: num(t.stores),
      publishedStores: num(t.published_stores),
      mercadoPagoConnected: num(t.mercadopago_connected),
      photos: num(t.photos),
      storageBytes: num(t.storage_bytes),
      orders: num(t.orders),
      paidOrders: num(t.paid_orders),
      pendingOrders: num(t.pending_orders),
      gmvCents: num(t.gmv_cents),
      gmvPeriodCents: num(t.gmv_period_cents),
      platformFeesCents: num(t.platform_fees_cents),
      paidViaMercadoPago: num(t.paid_mercadopago),
      downloads: num(t.downloads),
      signupsPeriod: num(t.signups_period),
      expiringIn7Days: num(expiring?.count),
    },
    subscriptions: subscriptionRows.map((row) => ({
      status: String(row.status),
      plan: String(row.plan),
      count: num(row.count),
    })),
    series: series.map((row) => ({
      date: String(row.date),
      signups: num(row.signups),
      orders: num(row.orders),
      paidOrders: num(row.paid_orders),
      gmvCents: num(row.gmv_cents),
    })),
  };
}

export async function listAccounts() {
  const rows = await db.execute<Row>(sql`
    select
      a.id, a.name, a.created_at,
      u.email as owner_email, u.email_verified_at is not null as verified,
      st.slug as store_slug, st.publication_status,
      ${EFFECTIVE_STATUS} as status,
      p.code as plan,
      s.trial_ends_at, s.current_period_end,
      exists(select 1 from store_payment_accounts m where m.store_id = st.id) as mercadopago,
      (select count(*) from photos ph where ph.store_id = st.id and ph.status <> 'archived') as photos,
      (select count(*) from orders o where o.store_id = st.id and o.status = 'paid') as paid_orders,
      (select coalesce(sum(o.total_cents), 0) from orders o where o.store_id = st.id and o.status = 'paid') as gmv_cents,
      (select max(o.created_at) from orders o where o.store_id = st.id) as last_order_at,
      (select max(l.created_at) from user_sessions l where l.user_id = u.id) as last_login_at
    from accounts a
    join users u on u.id = a.owner_user_id
    left join lateral (
      select * from stores x where x.account_id = a.id and x.deleted_at is null order by x.created_at limit 1
    ) st on true
    left join subscriptions s on s.account_id = a.id and s.ended_at is null
    left join plans p on p.id = s.plan_id
    where a.deleted_at is null
    order by a.created_at desc
    limit 500
  `);

  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    createdAt: row.created_at,
    ownerEmail: String(row.owner_email),
    verified: Boolean(row.verified),
    storeSlug: row.store_slug ? String(row.store_slug) : null,
    publicationStatus: row.publication_status ? String(row.publication_status) : null,
    status: String(row.status),
    plan: row.plan ? String(row.plan) : null,
    trialEndsAt: row.trial_ends_at ?? null,
    currentPeriodEnd: row.current_period_end ?? null,
    mercadoPago: Boolean(row.mercadopago),
    photos: num(row.photos),
    paidOrders: num(row.paid_orders),
    gmvCents: num(row.gmv_cents),
    lastOrderAt: row.last_order_at ?? null,
    lastLoginAt: row.last_login_at ?? null,
  }));
}

export async function recentOrders(limit = 20) {
  const rows = await db.execute<Row>(sql`
    select o.code, o.status, o.checkout_method, o.total_cents, o.created_at, o.paid_at,
      s.slug as store_slug
    from orders o join stores s on s.id = o.store_id
    order by o.created_at desc
    limit ${limit}
  `);
  return rows.map((row) => ({
    code: String(row.code),
    status: String(row.status),
    checkoutMethod: String(row.checkout_method),
    totalCents: num(row.total_cents),
    createdAt: row.created_at,
    paidAt: row.paid_at ?? null,
    storeSlug: String(row.store_slug),
  }));
}
