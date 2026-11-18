CREATE TABLE "albums" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price_cents" bigint,
	"status" text DEFAULT 'draft' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"cover_photo_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "albums_status_check" CHECK ("albums"."status" in ('draft', 'published', 'archived')),
	CONSTRAINT "albums_price_check" CHECK ("albums"."price_cents" is null or "albums"."price_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "download_logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "download_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"entitlement_id" uuid NOT NULL,
	"ip" "inet",
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"original_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"bytes" bigint NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"checksum_sha256" text NOT NULL,
	"original_filename" text NOT NULL,
	"uploaded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"photo_id" uuid NOT NULL,
	"photo_version_id" uuid NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_item_photos" (
	"order_item_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"photo_id" uuid NOT NULL,
	"photo_version_id" uuid NOT NULL,
	CONSTRAINT "order_item_photos_order_item_id_photo_id_pk" PRIMARY KEY("order_item_id","photo_id")
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"photo_id" uuid,
	"album_id" uuid,
	"title_snapshot" text NOT NULL,
	"price_cents" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_items_kind_check" CHECK ("order_items"."kind" in ('photo', 'album')),
	CONSTRAINT "order_items_target_check" CHECK (("order_items"."kind" = 'photo' and "order_items"."photo_id" is not null and "order_items"."album_id" is null) or ("order_items"."kind" = 'album' and "order_items"."album_id" is not null and "order_items"."photo_id" is null))
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"code" text NOT NULL,
	"customer_name" text NOT NULL,
	"customer_email" text NOT NULL,
	"status" text DEFAULT 'pending_payment' NOT NULL,
	"currency" text DEFAULT 'ARS' NOT NULL,
	"total_cents" bigint NOT NULL,
	"access_token_hash" text NOT NULL,
	"payment_instructions" text DEFAULT '' NOT NULL,
	"paid_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_status_check" CHECK ("orders"."status" in ('pending_payment', 'paid', 'cancelled')),
	CONSTRAINT "orders_total_check" CHECK ("orders"."total_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"method" text NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"recorded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_check" CHECK ("payments"."amount_cents" > 0),
	CONSTRAINT "payments_method_check" CHECK ("payments"."method" in ('transfer', 'cash', 'other'))
);
--> statement-breakpoint
CREATE TABLE "photo_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"photo_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"media_asset_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"album_id" uuid,
	"title" text DEFAULT '' NOT NULL,
	"price_cents" bigint,
	"status" text DEFAULT 'draft' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "photos_status_check" CHECK ("photos"."status" in ('draft', 'published', 'archived')),
	CONSTRAINT "photos_price_check" CHECK ("photos"."price_cents" is null or "photos"."price_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "store_profiles" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"draft" jsonb NOT NULL,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content" jsonb NOT NULL,
	"published_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_publications_version_check" CHECK ("store_publications"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "albums_id_store_uq" ON "albums" USING btree ("id","store_id");
--> statement-breakpoint
CREATE INDEX "albums_store_status_sort_idx" ON "albums" USING btree ("store_id","status","sort_order");
--> statement-breakpoint
CREATE INDEX "download_logs_entitlement_idx" ON "download_logs" USING btree ("entitlement_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_id_store_uq" ON "media_assets" USING btree ("id","store_id");
--> statement-breakpoint
CREATE INDEX "media_assets_store_checksum_idx" ON "media_assets" USING btree ("store_id","checksum_sha256");
--> statement-breakpoint
CREATE UNIQUE INDEX "order_entitlements_order_photo_uq" ON "order_entitlements" USING btree ("order_id","photo_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "order_item_photos_order_photo_uq" ON "order_item_photos" USING btree ("order_id","photo_id");
--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "orders_id_store_uq" ON "orders" USING btree ("id","store_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "orders_code_uq" ON "orders" USING btree ("code");
--> statement-breakpoint
CREATE INDEX "orders_store_status_created_idx" ON "orders" USING btree ("store_id","status","created_at");
--> statement-breakpoint
CREATE INDEX "payments_order_idx" ON "payments" USING btree ("order_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "photo_versions_photo_version_uq" ON "photo_versions" USING btree ("photo_id","version");
--> statement-breakpoint
CREATE UNIQUE INDEX "photo_versions_one_current_uq" ON "photo_versions" USING btree ("photo_id") WHERE "photo_versions"."is_current";
--> statement-breakpoint
CREATE UNIQUE INDEX "photos_id_store_uq" ON "photos" USING btree ("id","store_id");
--> statement-breakpoint
CREATE INDEX "photos_store_album_status_idx" ON "photos" USING btree ("store_id","album_id","status");
--> statement-breakpoint
CREATE UNIQUE INDEX "store_publications_store_version_uq" ON "store_publications" USING btree ("store_id","version");
--> statement-breakpoint
ALTER TABLE "albums" ADD CONSTRAINT "albums_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "download_logs" ADD CONSTRAINT "download_logs_entitlement_id_order_entitlements_id_fk" FOREIGN KEY ("entitlement_id") REFERENCES "public"."order_entitlements"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_entitlements" ADD CONSTRAINT "order_entitlements_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_entitlements" ADD CONSTRAINT "order_entitlements_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_entitlements" ADD CONSTRAINT "order_entitlements_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_entitlements" ADD CONSTRAINT "order_entitlements_photo_version_id_photo_versions_id_fk" FOREIGN KEY ("photo_version_id") REFERENCES "public"."photo_versions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_item_photos" ADD CONSTRAINT "order_item_photos_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_item_photos" ADD CONSTRAINT "order_item_photos_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_item_photos" ADD CONSTRAINT "order_item_photos_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_item_photos" ADD CONSTRAINT "order_item_photos_photo_version_id_photo_versions_id_fk" FOREIGN KEY ("photo_version_id") REFERENCES "public"."photo_versions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_album_id_albums_id_fk" FOREIGN KEY ("album_id") REFERENCES "public"."albums"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "photo_versions" ADD CONSTRAINT "photo_versions_photo_store_fk" FOREIGN KEY ("photo_id","store_id") REFERENCES "public"."photos"("id","store_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "photo_versions" ADD CONSTRAINT "photo_versions_asset_store_fk" FOREIGN KEY ("media_asset_id","store_id") REFERENCES "public"."media_assets"("id","store_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_album_store_fk" FOREIGN KEY ("album_id","store_id") REFERENCES "public"."albums"("id","store_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "store_profiles" ADD CONSTRAINT "store_profiles_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "store_profiles" ADD CONSTRAINT "store_profiles_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "store_publications" ADD CONSTRAINT "store_publications_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "store_publications" ADD CONSTRAINT "store_publications_published_by_user_id_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
