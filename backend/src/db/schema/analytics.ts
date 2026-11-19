import { sql } from "drizzle-orm";
import { check, date, index, integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core";

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
  },
  (table) => [
    primaryKey({ columns: [table.day, table.scope, table.visitorHash] }),
    index("page_visits_scope_day_idx").on(table.scope, table.day),
    check("page_visits_views_check", sql`${table.views} > 0`),
  ],
);
