CREATE TYPE "public"."pending_execution_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "pending_execution" (
	"id" text PRIMARY KEY NOT NULL,
	"billing_scope_id" text NOT NULL,
	"billing_scope_type" text NOT NULL,
	"execution_type" text NOT NULL,
	"ordering_key" text,
	"source" text NOT NULL,
	"user_id" text NOT NULL,
	"workflow_id" text,
	"workspace_id" text,
	"payload" jsonb NOT NULL,
	"status" "pending_execution_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"processing_started_at" timestamp,
	"error_message" text,
	"result" jsonb,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "copilot_feedback" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "copilot_feedback" CASCADE;--> statement-breakpoint
ALTER TABLE "system_billing_tier" ADD COLUMN "max_pending_age_seconds" integer;--> statement-breakpoint
ALTER TABLE "system_billing_tier" ADD COLUMN "max_pending_count" integer;--> statement-breakpoint
ALTER TABLE "pending_execution" ADD CONSTRAINT "pending_execution_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_execution" ADD CONSTRAINT "pending_execution_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_execution" ADD CONSTRAINT "pending_execution_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pending_execution_billing_scope_idx" ON "pending_execution" USING btree ("billing_scope_id","status","next_attempt_at","created_at");--> statement-breakpoint
CREATE INDEX "pending_execution_workflow_idx" ON "pending_execution" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "pending_execution_ordering_key_idx" ON "pending_execution" USING btree ("billing_scope_id","ordering_key","status","created_at");--> statement-breakpoint
CREATE INDEX "pending_execution_source_idx" ON "pending_execution" USING btree ("source");--> statement-breakpoint
CREATE INDEX "pending_execution_status_idx" ON "pending_execution" USING btree ("status");--> statement-breakpoint
ALTER TABLE "system_billing_tier" ADD CONSTRAINT "system_billing_tier_max_pending_age_check" CHECK ("system_billing_tier"."max_pending_age_seconds" is null or "system_billing_tier"."max_pending_age_seconds" >= 0);--> statement-breakpoint
ALTER TABLE "system_billing_tier" ADD CONSTRAINT "system_billing_tier_max_pending_count_check" CHECK ("system_billing_tier"."max_pending_count" is null or "system_billing_tier"."max_pending_count" >= 0);