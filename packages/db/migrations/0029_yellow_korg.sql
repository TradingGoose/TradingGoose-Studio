CREATE TABLE "monitor_view" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"config" jsonb DEFAULT '{}' NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "monitor_view" ADD CONSTRAINT "monitor_view_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitor_view" ADD CONSTRAINT "monitor_view_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "monitor_view_workspace_idx" ON "monitor_view" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "monitor_view_user_idx" ON "monitor_view" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "monitor_view_workspace_user_idx" ON "monitor_view" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "monitor_view_workspace_user_active_idx" ON "monitor_view" USING btree ("workspace_id","user_id","is_active");--> statement-breakpoint
CREATE INDEX "monitor_view_workspace_user_sort_idx" ON "monitor_view" USING btree ("workspace_id","user_id","sort_order");