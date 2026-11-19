import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";

// Cookie-free visit counter. `visitorHash` is a daily, salted, one-way hash of
// IP + user agent: it lets us count unique visitors per day without storing
// personal data, and it cannot be linked across days.
// `scope` is "landing" for the platform home page or "store:<uuid>".
export const pageVisits = pgTable(
  "page_visits",
  {
    day: date("day", { mode: "string" }).notNull(),
    scope: text("scope").notNull(),
    visitorHash: text("visitor_hash").notNull(),
    views: integer("views").notNull().default(1),
    // Where the visitor came from on their first view of the day (utm_* or the
    // referrer's site). Empty means unknown/direct.
    source: text("source").notNull().default(""),
    medium: text("medium").notNull().default(""),
    campaign: text("campaign").notNull().default(""),
    content: text("content").notNull().default(""),
  },
  (table) => [
    primaryKey({ columns: [table.day, table.scope, table.visitorHash] }),
    index("page_visits_scope_day_idx").on(table.scope, table.day),
    index("page_visits_scope_source_idx").on(table.scope, table.source, table.day),
    check("page_visits_views_check", sql`${table.views} > 0`),
  ],
);

// Where a photographer came from when they signed up (first touch of the
// browser session). One row per user; no personal data beyond the user id.
export const userAttribution = pgTable("user_attribution", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  source: text("source").notNull().default(""),
  medium: text("medium").notNull().default(""),
  campaign: text("campaign").notNull().default(""),
  content: text("content").notNull().default(""),
  landingPath: text("landing_path").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});
