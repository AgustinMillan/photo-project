CREATE TABLE "subscription_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"plan_id" uuid,
	"provider" text DEFAULT 'mercadopago' NOT NULL,
	"provider_charge_id" text NOT NULL,
	"provider_payment_id" text,
	"status" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" text DEFAULT 'ARS' NOT NULL,
	"paid_at" timestamp with time zone,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_visits" (
	"day" date NOT NULL,
	"scope" text NOT NULL,
	"visitor_hash" text NOT NULL,
	"views" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "page_visits_day_scope_visitor_hash_pk" PRIMARY KEY("day","scope","visitor_hash"),
	CONSTRAINT "page_visits_views_check" CHECK ("page_visits"."views" > 0)
);
--> statement-breakpoint
ALTER TABLE "subscription_events" DROP CONSTRAINT "subscription_events_type_check";--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "price_cents" bigint;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "currency" text DEFAULT 'ARS' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "mp_preapproval_id" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "mp_preapproval_status" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "mp_payer_email" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "mp_plan_id" uuid;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "mp_next_payment_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_payments_provider_charge_uq" ON "subscription_payments" USING btree ("provider","provider_charge_id");--> statement-breakpoint
CREATE INDEX "subscription_payments_subscription_idx" ON "subscription_payments" USING btree ("subscription_id","created_at");--> statement-breakpoint
CREATE INDEX "page_visits_scope_day_idx" ON "page_visits" USING btree ("scope","day");--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_mp_plan_id_plans_id_fk" FOREIGN KEY ("mp_plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_mp_preapproval_uq" ON "subscriptions" USING btree ("mp_preapproval_id");--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_price_check" CHECK ("plans"."price_cents" is null or "plans"."price_cents" > 0);--> statement-breakpoint
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_type_check" CHECK ("subscription_events"."event_type" in ('created', 'trial_started', 'activated', 'renewed', 'plan_changed', 'expired', 'cancelled', 'suspended', 'reactivated', 'payment_received', 'payment_failed', 'reminder_sent', 'provider_linked'));--> statement-breakpoint
UPDATE "plans" SET "price_cents" = 1500000, "description" = 'Tu tienda con cobro y entrega automática.', "updated_at" = now() WHERE "code" = 'base' AND "price_cents" IS NULL;
