import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for integration tests.");
}

const client = postgres(databaseUrl, { max: 1 });

afterAll(async () => {
  await client.end({ timeout: 5 });
});

describe("schema", () => {
  it("creates every table through Phase 5 and payment accounts", async () => {
    const rows = await client<{ table_name: string }[]>`
      select table_name
      from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name
    `;

    expect(rows.map((row) => row.table_name)).toEqual([
      "accounts",
      "albums",
      "audit_logs",
      "download_logs",
      "email_verification_tokens",
      "media_assets",
      "order_entitlements",
      "order_item_photos",
      "order_items",
      "orders",
      "password_reset_tokens",
      "payments",
      "photo_versions",
      "photos",
      "plan_entitlements",
      "plans",
      "store_domains",
      "store_invitations",
      "store_memberships",
      "store_payment_accounts",
      "store_profiles",
      "store_publications",
      "stores",
      "subscription_events",
      "subscriptions",
      "user_sessions",
      "users",
    ]);
  });

  it("seeds the configurable plans and keeps one open subscription per account", async () => {
    const planRows = await client<{ code: string; status: string }[]>`
      select code, status from plans order by sort_order
    `;

    expect(planRows).toEqual([
      { code: "base", status: "active" },
      { code: "intermediate", status: "active" },
      { code: "business", status: "active" },
    ]);

    const indexes = await client<{ indexname: string }[]>`
      select indexname
      from pg_indexes
      where schemaname = 'public'
        and tablename = 'subscriptions'
        and indexname = 'subscriptions_one_open_per_account_uq'
    `;

    expect(indexes).toHaveLength(1);
  });

  it("enforces one account per owner", async () => {
    const rows = await client<{ indexname: string }[]>`
      select indexname
      from pg_indexes
      where schemaname = 'public'
        and tablename = 'accounts'
        and indexname = 'accounts_owner_user_uq'
    `;

    expect(rows).toHaveLength(1);
  });

  it("uses identity for append-only audit logs", async () => {
    const rows = await client<{ is_identity: string }[]>`
      select is_identity
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'audit_logs'
        and column_name = 'id'
    `;

    expect(rows).toHaveLength(1);
    expect(rows[0]?.is_identity).toBe("YES");
  });
});
