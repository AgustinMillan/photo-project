import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const USER_STATUSES = ["pending_verification", "active", "disabled", "deleted"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    status: text("status").$type<UserStatus>().notNull().default("pending_verification"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true, mode: "date" }),
    displayName: text("display_name"),
    locale: text("locale").notNull().default("es"),
    timezone: text("timezone").notNull().default("UTC"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    uniqueIndex("users_email_lower_uq").on(sql`lower(${table.email})`),
    index("users_status_idx").on(table.status),
    check(
      "users_status_check",
      sql`${table.status} in ('pending_verification', 'active', 'disabled', 'deleted')`,
    ),
  ],
);
