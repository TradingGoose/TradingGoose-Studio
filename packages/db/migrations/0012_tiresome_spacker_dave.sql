CREATE TABLE "watchlist_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"watchlist_id" uuid NOT NULL,
	"container_id" uuid,
	"listing" jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watchlist_table" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"settings" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "trigger_block_id" text;--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "deployment_version_id" text;--> statement-breakpoint
ALTER TABLE "watchlist_item" ADD CONSTRAINT "watchlist_item_watchlist_id_watchlist_table_id_fk" FOREIGN KEY ("watchlist_id") REFERENCES "public"."watchlist_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_item" ADD CONSTRAINT "watchlist_item_container_id_watchlist_table_id_fk" FOREIGN KEY ("container_id") REFERENCES "public"."watchlist_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_table" ADD CONSTRAINT "watchlist_table_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_table" ADD CONSTRAINT "watchlist_table_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_table" ADD CONSTRAINT "watchlist_table_parent_id_watchlist_table_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."watchlist_table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "watchlist_item_watchlist_idx" ON "watchlist_item" USING btree ("watchlist_id");--> statement-breakpoint
CREATE INDEX "watchlist_item_watchlist_container_sort_idx" ON "watchlist_item" USING btree ("watchlist_id","container_id","sort_order");--> statement-breakpoint
CREATE INDEX "watchlist_item_container_sort_idx" ON "watchlist_item" USING btree ("container_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "watchlist_item_watchlist_listing_identity_unique" ON "watchlist_item" USING btree ("watchlist_id",coalesce("listing"->>'listing_type', ''),coalesce("listing"->>'listing_id', ''),coalesce("listing"->>'base_id', ''),coalesce("listing"->>'quote_id', ''));--> statement-breakpoint
CREATE INDEX "watchlist_table_workspace_user_idx" ON "watchlist_table" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "watchlist_table_workspace_user_parent_idx" ON "watchlist_table" USING btree ("workspace_id","user_id","parent_id");--> statement-breakpoint
CREATE INDEX "watchlist_table_parent_sort_idx" ON "watchlist_table" USING btree ("parent_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "watchlist_table_workspace_user_name_unique" ON "watchlist_table" USING btree ("workspace_id","user_id","name") WHERE "watchlist_table"."parent_id" is null;--> statement-breakpoint
ALTER TABLE "chat" ADD CONSTRAINT "chat_deployment_version_id_workflow_deployment_version_id_fk" FOREIGN KEY ("deployment_version_id") REFERENCES "public"."workflow_deployment_version"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_workflow_trigger_unique" ON "chat" USING btree ("workflow_id","trigger_block_id");--> statement-breakpoint
CREATE INDEX "chat_deployment_version_idx" ON "chat" USING btree ("deployment_version_id");