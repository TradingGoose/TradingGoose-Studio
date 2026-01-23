CREATE TABLE "custom_indicators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"series" text DEFAULT 'normal' NOT NULL,
	"precision" integer DEFAULT 2 NOT NULL,
	"calc_params" jsonb DEFAULT '[]' NOT NULL,
	"figures" jsonb DEFAULT '[]' NOT NULL,
	"calc_code" text DEFAULT '' NOT NULL,
	"draw_code" text,
	"tooltip_code" text,
	"regenerate_figures_code" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "copilot_auto_allowed_tools" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "custom_indicators" ADD CONSTRAINT "custom_indicators_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_indicators" ADD CONSTRAINT "custom_indicators_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "custom_indicators_workspace_id_idx" ON "custom_indicators" USING btree ("workspace_id");