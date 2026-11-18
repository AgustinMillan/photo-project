import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { stores } from "./stores.js";
import { users } from "./users.js";

// ---------------------------------------------------------------------------
// Phase 3 — storefront profile (draft) and immutable publications
// ---------------------------------------------------------------------------

export const STOREFRONT_SECTION_KEYS = ["hero", "albums", "about", "contact"] as const;
export type StorefrontSectionKey = (typeof STOREFRONT_SECTION_KEYS)[number];

export type StorefrontContent = {
  displayName: string;
  tagline: string;
  bio: string;
  contactEmail: string;
  phone: string;
  instagram: string;
  website: string;
  coverPhotoId: string | null;
  paymentInstructions: string;
  watermarkText: string;
  sections: Array<{ key: StorefrontSectionKey; enabled: boolean }>;
};

export const storeProfiles = pgTable("store_profiles", {
  storeId: uuid("store_id")
    .primaryKey()
    .references(() => stores.id, { onDelete: "restrict" }),
  draft: jsonb("draft").$type<StorefrontContent>().notNull(),
  updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const storePublications = pgTable(
  "store_publications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    content: jsonb("content").$type<StorefrontContent>().notNull(),
    publishedByUserId: uuid("published_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("store_publications_store_version_uq").on(table.storeId, table.version),
    check("store_publications_version_check", sql`${table.version} > 0`),
  ],
);

// ---------------------------------------------------------------------------
// Phase 4 — catalog and media
// ---------------------------------------------------------------------------

export const CATALOG_STATUSES = ["draft", "published", "archived"] as const;
export type CatalogStatus = (typeof CATALOG_STATUSES)[number];

export const albums = pgTable(
  "albums",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    // Null means the album cannot be bought as a whole.
    priceCents: bigint("price_cents", { mode: "number" }),
    status: text("status").$type<CatalogStatus>().notNull().default("draft"),
    sortOrder: integer("sort_order").notNull().default(0),
    coverPhotoId: uuid("cover_photo_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    // Target of the tenant-safe composite FK from photos.
    uniqueIndex("albums_id_store_uq").on(table.id, table.storeId),
    index("albums_store_status_sort_idx").on(table.storeId, table.status, table.sortOrder),
    check("albums_status_check", sql`${table.status} in ('draft', 'published', 'archived')`),
    check("albums_price_check", sql`${table.priceCents} is null or ${table.priceCents} > 0`),
  ],
);

export const mediaAssets = pgTable(
  "media_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "restrict" }),
    originalKey: text("original_key").notNull(),
    mimeType: text("mime_type").notNull(),
    bytes: bigint("bytes", { mode: "number" }).notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    checksumSha256: text("checksum_sha256").notNull(),
    originalFilename: text("original_filename").notNull(),
    uploadedByUserId: uuid("uploaded_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("media_assets_id_store_uq").on(table.id, table.storeId),
    index("media_assets_store_checksum_idx").on(table.storeId, table.checksumSha256),
  ],
);

export const photos = pgTable(
  "photos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "restrict" }),
    albumId: uuid("album_id"),
    title: text("title").notNull().default(""),
    // Null means the photo cannot be bought on its own.
    priceCents: bigint("price_cents", { mode: "number" }),
    status: text("status").$type<CatalogStatus>().notNull().default("draft"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("photos_id_store_uq").on(table.id, table.storeId),
    // A photo can only belong to an album of the same store.
    foreignKey({
      name: "photos_album_store_fk",
      columns: [table.albumId, table.storeId],
      foreignColumns: [albums.id, albums.storeId],
    }).onDelete("restrict"),
    index("photos_store_album_status_idx").on(table.storeId, table.albumId, table.status),
    check("photos_status_check", sql`${table.status} in ('draft', 'published', 'archived')`),
    check("photos_price_check", sql`${table.priceCents} is null or ${table.priceCents} > 0`),
  ],
);

export const photoVersions = pgTable(
  "photo_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    photoId: uuid("photo_id").notNull(),
    storeId: uuid("store_id").notNull(),
    mediaAssetId: uuid("media_asset_id").notNull(),
    version: integer("version").notNull(),
    isCurrent: boolean("is_current").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "photo_versions_photo_store_fk",
      columns: [table.photoId, table.storeId],
      foreignColumns: [photos.id, photos.storeId],
    }).onDelete("restrict"),
    foreignKey({
      name: "photo_versions_asset_store_fk",
      columns: [table.mediaAssetId, table.storeId],
      foreignColumns: [mediaAssets.id, mediaAssets.storeId],
    }).onDelete("restrict"),
    uniqueIndex("photo_versions_photo_version_uq").on(table.photoId, table.version),
    uniqueIndex("photo_versions_one_current_uq").on(table.photoId).where(sql`${table.isCurrent}`),
  ],
);

// ---------------------------------------------------------------------------
// Phase 5 — orders, manual payments and download rights
// ---------------------------------------------------------------------------

export const ORDER_STATUSES = ["pending_payment", "paid", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_METHODS = ["transfer", "cash", "other", "mercadopago"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const CHECKOUT_METHODS = ["transfer", "mercadopago"] as const;
export type CheckoutMethod = (typeof CHECKOUT_METHODS)[number];

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    customerName: text("customer_name").notNull(),
    customerEmail: text("customer_email").notNull(),
    status: text("status").$type<OrderStatus>().notNull().default("pending_payment"),
    currency: text("currency").notNull().default("ARS"),
    totalCents: bigint("total_cents", { mode: "number" }).notNull(),
    accessTokenHash: text("access_token_hash").notNull(),
    paymentInstructions: text("payment_instructions").notNull().default(""),
    checkoutMethod: text("checkout_method").$type<CheckoutMethod>().notNull().default("transfer"),
    // Platform commission frozen at checkout (0 while the fee is disabled).
    platformFeeCents: bigint("platform_fee_cents", { mode: "number" }).notNull().default(0),
    mpPreferenceId: text("mp_preference_id"),
    paidAt: timestamp("paid_at", { withTimezone: true, mode: "date" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("orders_id_store_uq").on(table.id, table.storeId),
    uniqueIndex("orders_code_uq").on(table.code),
    index("orders_store_status_created_idx").on(table.storeId, table.status, table.createdAt),
    check("orders_status_check", sql`${table.status} in ('pending_payment', 'paid', 'cancelled')`),
    check("orders_total_check", sql`${table.totalCents} > 0`),
    check(
      "orders_checkout_method_check",
      sql`${table.checkoutMethod} in ('transfer', 'mercadopago')`,
    ),
    check(
      "orders_platform_fee_check",
      sql`${table.platformFeeCents} >= 0 and ${table.platformFeeCents} <= ${table.totalCents}`,
    ),
  ],
);

export const ORDER_ITEM_KINDS = ["photo", "album"] as const;
export type OrderItemKind = (typeof ORDER_ITEM_KINDS)[number];

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    kind: text("kind").$type<OrderItemKind>().notNull(),
    photoId: uuid("photo_id").references(() => photos.id, { onDelete: "restrict" }),
    albumId: uuid("album_id").references(() => albums.id, { onDelete: "restrict" }),
    titleSnapshot: text("title_snapshot").notNull(),
    priceCents: bigint("price_cents", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("order_items_order_idx").on(table.orderId),
    check("order_items_kind_check", sql`${table.kind} in ('photo', 'album')`),
    check(
      "order_items_target_check",
      sql`(${table.kind} = 'photo' and ${table.photoId} is not null and ${table.albumId} is null) or (${table.kind} = 'album' and ${table.albumId} is not null and ${table.photoId} is null)`,
    ),
  ],
);

// Exact photo versions covered by each order item, frozen at checkout. Rights
// are only granted from these rows once the order is paid.
export const orderItemPhotos = pgTable(
  "order_item_photos",
  {
    orderItemId: uuid("order_item_id")
      .notNull()
      .references(() => orderItems.id, { onDelete: "restrict" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    photoId: uuid("photo_id")
      .notNull()
      .references(() => photos.id, { onDelete: "restrict" }),
    photoVersionId: uuid("photo_version_id")
      .notNull()
      .references(() => photoVersions.id, { onDelete: "restrict" }),
  },
  (table) => [
    primaryKey({ columns: [table.orderItemId, table.photoId] }),
    // Deduplication guarantee: a photo is covered at most once per order.
    uniqueIndex("order_item_photos_order_photo_uq").on(table.orderId, table.photoId),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    method: text("method").$type<PaymentMethod>().notNull(),
    reference: text("reference").notNull().default(""),
    // External id (Mercado Pago payment id). Unique so a webhook delivered
    // twice can never count the same payment twice.
    providerPaymentId: text("provider_payment_id"),
    recordedByUserId: uuid("recorded_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("payments_order_idx").on(table.orderId),
    check("payments_amount_check", sql`${table.amountCents} > 0`),
    check(
      "payments_method_check",
      sql`${table.method} in ('transfer', 'cash', 'other', 'mercadopago')`,
    ),
    uniqueIndex("payments_provider_payment_uq")
      .on(table.providerPaymentId)
      .where(sql`${table.providerPaymentId} is not null`),
  ],
);

export const orderEntitlements = pgTable(
  "order_entitlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "restrict" }),
    photoId: uuid("photo_id")
      .notNull()
      .references(() => photos.id, { onDelete: "restrict" }),
    photoVersionId: uuid("photo_version_id")
      .notNull()
      .references(() => photoVersions.id, { onDelete: "restrict" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("order_entitlements_order_photo_uq").on(table.orderId, table.photoId)],
);

export const downloadLogs = pgTable(
  "download_logs",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    entitlementId: uuid("entitlement_id")
      .notNull()
      .references(() => orderEntitlements.id, { onDelete: "restrict" }),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [index("download_logs_entitlement_idx").on(table.entitlementId, table.createdAt)],
);
