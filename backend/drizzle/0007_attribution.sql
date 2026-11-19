CREATE TABLE "user_attribution" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"medium" text DEFAULT '' NOT NULL,
	"campaign" text DEFAULT '' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"landing_path" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "page_visits" ADD COLUMN "source" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "page_visits" ADD COLUMN "medium" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "page_visits" ADD COLUMN "campaign" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "page_visits" ADD COLUMN "content" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_attribution" ADD CONSTRAINT "user_attribution_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_visits_scope_source_idx" ON "page_visits" USING btree ("scope","source","day");