import { sql } from "drizzle-orm";
import { boolean, check, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { stores } from "./stores.js";
import { users } from "./users.js";

/**
 * A store's own payment account (Mercado Pago, connected via OAuth). Money goes
 * straight to the photographer; the platform only keeps encrypted tokens to
 * create checkouts and verify payments on their behalf.
 */
export const storePaymentAccounts = pgTable(
  "store_payment_accounts",
  {
    storeId: uuid("store_id")
      .primaryKey()
      .references(() => stores.id, { onDelete: "restrict" }),
    provider: text("provider").notNull().default("mercadopago"),
    providerUserId: text("provider_user_id").notNull(),
    accessTokenEnc: text("access_token_enc").notNull(),
    refreshTokenEnc: text("refresh_token_enc"),
    publicKey: text("public_key"),
    liveMode: boolean("live_mode").notNull().default(true),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    connectedByUserId: uuid("connected_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    connectedAt: timestamp("connected_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    check("store_payment_accounts_provider_check", sql`${table.provider} in ('mercadopago')`),
  ],
);
