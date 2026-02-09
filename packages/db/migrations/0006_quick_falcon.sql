CREATE TABLE "pine_indicators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text,
	"name" text DEFAULT 'New Indicator' NOT NULL,
	"color" text DEFAULT '#3972F6' NOT NULL,
	"pine_code" text DEFAULT '' NOT NULL,
	"input_meta" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pine_indicators" ADD CONSTRAINT "pine_indicators_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pine_indicators" ADD CONSTRAINT "pine_indicators_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pine_indicators_workspace_id_idx" ON "pine_indicators" USING btree ("workspace_id");