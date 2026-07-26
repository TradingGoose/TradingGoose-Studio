DROP INDEX "watchlist_item_watchlist_container_sort_idx";--> statement-breakpoint
DROP INDEX "watchlist_item_watchlist_listing_identity_unique";--> statement-breakpoint
DROP INDEX "watchlist_table_workspace_user_name_unique";--> statement-breakpoint
ALTER TABLE "watchlist_item" ALTER COLUMN "watchlist_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "watchlist_table" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "watchlist_item" ADD COLUMN "workspace_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "watchlist_item" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "watchlist_item" ADD CONSTRAINT "watchlist_item_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_item" ADD CONSTRAINT "watchlist_item_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "watchlist_item_workspace_user_idx" ON "watchlist_item" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "watchlist_item_workspace_container_sort_idx" ON "watchlist_item" USING btree ("workspace_id","user_id","container_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "watchlist_item_watchlist_listing_identity_unique" ON "watchlist_item" USING btree ("workspace_id",coalesce("container_id"::text, ''),coalesce("listing"->>'listing_type', ''),coalesce("listing"->>'listing_id', ''),coalesce("listing"->>'base_id', ''),coalesce("listing"->>'quote_id', '')) WHERE "watchlist_item"."user_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "watchlist_table_workspace_user_name_unique" ON "watchlist_table" USING btree ("workspace_id","name") WHERE "watchlist_table"."user_id" is null and "watchlist_table"."parent_id" is null;--> statement-breakpoint
ALTER TABLE "watchlist_table" DROP COLUMN "is_system";