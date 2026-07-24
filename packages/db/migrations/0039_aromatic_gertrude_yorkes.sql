CREATE TABLE "layout_maps" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"layout" jsonb NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "layout_pairs" (
	"layout_id" text NOT NULL,
	"color" text NOT NULL,
	"context" jsonb NOT NULL,
	CONSTRAINT "layout_pairs_layout_id_color_pk" PRIMARY KEY("layout_id","color")
);
--> statement-breakpoint
CREATE TABLE "layout_widgets" (
	"id" text PRIMARY KEY NOT NULL,
	"layout_id" text NOT NULL,
	"pair_color" text NOT NULL,
	"params" jsonb
);
--> statement-breakpoint
DROP TABLE "layout_map" CASCADE;--> statement-breakpoint
ALTER TABLE "layout_maps" ADD CONSTRAINT "layout_maps_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layout_maps" ADD CONSTRAINT "layout_maps_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layout_pairs" ADD CONSTRAINT "layout_pairs_layout_id_layout_maps_id_fk" FOREIGN KEY ("layout_id") REFERENCES "public"."layout_maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layout_widgets" ADD CONSTRAINT "layout_widgets_layout_id_layout_maps_id_fk" FOREIGN KEY ("layout_id") REFERENCES "public"."layout_maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "layout_maps_workspace_idx" ON "layout_maps" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "layout_maps_user_idx" ON "layout_maps" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "layout_maps_workspace_user_idx" ON "layout_maps" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "layout_maps_workspace_user_active_idx" ON "layout_maps" USING btree ("workspace_id","user_id","is_active");--> statement-breakpoint
CREATE INDEX "layout_widgets_layout_id_idx" ON "layout_widgets" USING btree ("layout_id");