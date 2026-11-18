import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const ACCOUNT_TYPES = ["individual", "studio"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_STATUSES = ["active", "suspended", "closed"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    type: text("type").$type<AccountType>().notNull().default("individual"),
    name: text("name").notNull(),
    billingEmail: text("billing_email").notNull(),
    status: text("status").$type<AccountStatus>().notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    uniqueIndex("accounts_owner_user_uq").on(table.ownerUserId),
    index("accounts_status_idx").on(table.status),
    check("accounts_type_check", sql`${table.type} in ('individual', 'studio')`),
    check("accounts_status_check", sql`${table.status} in ('active', 'suspended', 'closed')`),
  ],
);
