CREATE TABLE "store_coupons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"code" text NOT NULL,
	"percent_off" integer NOT NULL,
	"applies_to" text DEFAULT 'all' NOT NULL,
	"max_uses" integer,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"show_in_store" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_coupons_percent_check" CHECK ("store_coupons"."percent_off" between 1 and 90),
	CONSTRAINT "store_coupons_scope_check" CHECK ("store_coupons"."applies_to" in ('all', 'photos', 'albums')),
	CONSTRAINT "store_coupons_max_uses_check" CHECK ("store_coupons"."max_uses" is null or "store_coupons"."max_uses" > 0),
	CONSTRAINT "store_coupons_code_check" CHECK ("store_coupons"."code" ~ '^[A-Z0-9_-]{3,30}$')
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "coupon_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "coupon_code" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "discount_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "store_coupons" ADD CONSTRAINT "store_coupons_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "store_coupons_store_code_uq" ON "store_coupons" USING btree ("store_id","code");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_coupon_id_store_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."store_coupons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_coupon_idx" ON "orders" USING btree ("coupon_id","status");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_discount_check" CHECK ("orders"."discount_cents" >= 0);