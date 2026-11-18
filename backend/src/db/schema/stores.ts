import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "./accounts.js";
import { users } from "./users.js";

export const STORE_STATUSES = ["active", "suspended", "archived", "pending_deletion"] as const;
export type StoreStatus = (typeof STORE_STATUSES)[number];

export const STORE_PUBLICATION_STATUSES = ["draft", "published", "unpublished"] as const;
export type StorePublicationStatus = (typeof STORE_PUBLICATION_STATUSES)[number];

export const STORE_ROLES = ["OWNER", "ADMIN", "PHOTOGRAPHER", "EDITOR"] as const;
export type StoreRole = (typeof STORE_ROLES)[number];

export const STORE_MEMBERSHIP_STATUSES = ["invited", "active", "suspended", "removed"] as const;
export type StoreMembershipStatus = (typeof STORE_MEMBERSHIP_STATUSES)[number];

export const STORE_INVITATION_STATUSES = ["pending", "accepted", "expired", "revoked"] as const;
export type StoreInvitationStatus = (typeof STORE_INVITATION_STATUSES)[number];

export const STORE_DOMAIN_TYPES = ["platform_subdomain", "custom"] as const;
export type StoreDomainType = (typeof STORE_DOMAIN_TYPES)[number];

export const STORE_DOMAIN_VERIFICATION_STATUSES = [
  "pending",
  "verified",
  "failed",
  "disabled",
] as const;
export type StoreDomainVerificationStatus = (typeof STORE_DOMAIN_VERIFICATION_STATUSES)[number];

export const stores = pgTable(
  "stores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    status: text("status").$type<StoreStatus>().notNull().default("active"),
    publicationStatus: text("publication_status")
      .$type<StorePublicationStatus>()
      .notNull()
      .default("draft"),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    uniqueIndex("stores_slug_lower_uq")
      .on(sql`lower(${table.slug})`)
      .where(sql`${table.deletedAt} is null`),
    // Required by later tenant-safe composite foreign keys.
    uniqueIndex("stores_id_account_uq").on(table.id, table.accountId),
    index("stores_account_status_idx").on(table.accountId, table.status),
    index("stores_publication_status_idx").on(table.publicationStatus),
    index("stores_created_at_idx").on(table.createdAt),
    check(
      "stores_status_check",
      sql`${table.status} in ('active', 'suspended', 'archived', 'pending_deletion')`,
    ),
    check(
      "stores_publication_status_check",
      sql`${table.publicationStatus} in ('draft', 'published', 'unpublished')`,
    ),
    check(
      "stores_slug_format_check",
      sql`${table.slug} ~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$' and ${table.slug} !~ '--'`,
    ),
  ],
);

export const storeMemberships = pgTable(
  "store_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    role: text("role").$type<StoreRole>().notNull(),
    status: text("status").$type<StoreMembershipStatus>().notNull().default("active"),
    invitedByUserId: uuid("invited_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("store_memberships_store_user_uq").on(table.storeId, table.userId),
    index("store_memberships_user_status_idx").on(table.userId, table.status),
    index("store_memberships_store_role_status_idx").on(table.storeId, table.role, table.status),
    check(
      "store_memberships_role_check",
      sql`${table.role} in ('OWNER', 'ADMIN', 'PHOTOGRAPHER', 'EDITOR')`,
    ),
    check(
      "store_memberships_status_check",
      sql`${table.status} in ('invited', 'active', 'suspended', 'removed')`,
    ),
  ],
);

export const storeInvitations = pgTable(
  "store_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "restrict" }),
    email: text("email").notNull(),
    role: text("role").$type<Exclude<StoreRole, "OWNER">>().notNull(),
    tokenHash: text("token_hash").notNull(),
    status: text("status").$type<StoreInvitationStatus>().notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    invitedByUserId: uuid("invited_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    acceptedByUserId: uuid("accepted_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("store_invitations_token_hash_uq").on(table.tokenHash),
    uniqueIndex("store_invitations_pending_email_uq")
      .on(table.storeId, sql`lower(${table.email})`)
      .where(sql`${table.status} = 'pending'`),
    index("store_invitations_expires_idx").on(table.expiresAt),
    check(
      "store_invitations_role_check",
      sql`${table.role} in ('ADMIN', 'PHOTOGRAPHER', 'EDITOR')`,
    ),
    check(
      "store_invitations_status_check",
      sql`${table.status} in ('pending', 'accepted', 'expired', 'revoked')`,
    ),
  ],
);

export const storeDomains = pgTable(
  "store_domains",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "restrict" }),
    hostname: text("hostname").notNull(),
    type: text("type").$type<StoreDomainType>().notNull(),
    verificationStatus: text("verification_status")
      .$type<StoreDomainVerificationStatus>()
      .notNull()
      .default("pending"),
    isPrimary: boolean("is_primary").notNull().default(false),
    verificationToken: text("verification_token"),
    verifiedAt: timestamp("verified_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("store_domains_hostname_lower_uq").on(sql`lower(${table.hostname})`),
    uniqueIndex("store_domains_one_primary_uq")
      .on(table.storeId)
      .where(sql`${table.isPrimary} = true`),
    index("store_domains_store_idx").on(table.storeId),
    check("store_domains_type_check", sql`${table.type} in ('platform_subdomain', 'custom')`),
    check(
      "store_domains_verification_status_check",
      sql`${table.verificationStatus} in ('pending', 'verified', 'failed', 'disabled')`,
    ),
  ],
);
