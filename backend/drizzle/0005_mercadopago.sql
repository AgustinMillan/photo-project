CREATE TABLE "store_payment_accounts" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'mercadopago' NOT NULL,
	"provider_user_id" text NOT NULL,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text,
	"public_key" text,
	"live_mode" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone,
	"connected_by_user_id" uuid,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_payment_accounts_provider_check" CHECK ("store_payment_accounts"."provider" in ('mercadopago'))
);
--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_method_check";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "checkout_method" text DEFAULT 'transfer' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "platform_fee_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "mp_preference_id" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "provider_payment_id" text;--> statement-breakpoint
ALTER TABLE "store_payment_accounts" ADD CONSTRAINT "store_payment_accounts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_payment_accounts" ADD CONSTRAINT "store_payment_accounts_connected_by_user_id_users_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_payment_uq" ON "payments" USING btree ("provider_payment_id") WHERE "payments"."provider_payment_id" is not null;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_checkout_method_check" CHECK ("orders"."checkout_method" in ('transfer', 'mercadopago'));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_platform_fee_check" CHECK ("orders"."platform_fee_cents" >= 0 and "orders"."platform_fee_cents" <= "orders"."total_cents");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_method_check" CHECK ("payments"."method" in ('transfer', 'cash', 'other', 'mercadopago'));