import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "./accounts.js";
import { users } from "./users.js";

export const PLAN_STATUSES = ["active", "retired"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const SUBSCRIPTION_STATUSES = [
  "trial",
  "active",
  "expired",
  "cancelled",
  "suspended",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const SUBSCRIPTION_EVENT_TYPES = [
  "created",
  "trial_started",
  "activated",
  "renewed",
  "plan_changed",
  "expired",
  "cancelled",
  "suspended",
  "reactivated",
] as const;
export type SubscriptionEventType = (typeof SUBSCRIPTION_EVENT_TYPES)[number];

export const plans = pgTable(
  "plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").$type<PlanStatus>().notNull().default("active"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("plans_code_uq").on(table.code),
    index("plans_status_sort_idx").on(table.status, table.sortOrder),
    check("plans_status_check", sql`${table.status} in ('active', 'retired')`),
    check("plans_sort_order_check", sql`${table.sortOrder} >= 0`),
    check("plans_code_format_check", sql`${table.code} ~ '^[a-z0-9][a-z0-9-]*$'`),
  ],
);

export const planEntitlements = pgTable(
  "plan_entitlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "restrict" }),
    featureKey: text("feature_key").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    limitValue: bigint("limit_value", { mode: "number" }),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("plan_entitlements_plan_feature_uq").on(table.planId, table.featureKey),
    index("plan_entitlements_feature_idx").on(table.featureKey),
    check(
      "plan_entitlements_feature_key_check",
      sql`${table.featureKey} ~ '^[a-z0-9][a-z0-9_.-]*$'`,
    ),
  ],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "restrict" }),
    status: text("status").$type<SubscriptionStatus>().notNull().default("trial"),
    trialStartedAt: timestamp("trial_started_at", { withTimezone: true, mode: "date" }),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true, mode: "date" }),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true, mode: "date" }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true, mode: "date" }),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true, mode: "date" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "date" }),
    suspendedAt: timestamp("suspended_at", { withTimezone: true, mode: "date" }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("subscriptions_one_open_per_account_uq")
      .on(table.accountId)
      .where(sql`${table.endedAt} is null`),
    index("subscriptions_account_status_idx").on(table.accountId, table.status),
    index("subscriptions_current_period_end_idx").on(table.currentPeriodEnd),
    check(
      "subscriptions_status_check",
      sql`${table.status} in ('trial', 'active', 'expired', 'cancelled', 'suspended')`,
    ),
    check(
      "subscriptions_ended_at_check",
      sql`${table.endedAt} is null or ${table.endedAt} >= ${table.startedAt}`,
    ),
    check(
      "subscriptions_trial_dates_check",
      sql`${table.trialEndsAt} is null or ${table.trialStartedAt} is not null`,
    ),
  ],
);

export const subscriptionEvents = pgTable(
  "subscription_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "restrict" }),
    eventType: text("event_type").$type<SubscriptionEventType>().notNull(),
    fromStatus: text("from_status").$type<SubscriptionStatus>(),
    toStatus: text("to_status").$type<SubscriptionStatus>(),
    fromPlanId: uuid("from_plan_id").references(() => plans.id, { onDelete: "set null" }),
    toPlanId: uuid("to_plan_id").references(() => plans.id, { onDelete: "set null" }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("subscription_events_subscription_created_idx").on(table.subscriptionId, table.createdAt),
    index("subscription_events_type_created_idx").on(table.eventType, table.createdAt),
    check(
      "subscription_events_type_check",
      sql`${table.eventType} in ('created', 'trial_started', 'activated', 'renewed', 'plan_changed', 'expired', 'cancelled', 'suspended', 'reactivated')`,
    ),
  ],
);
