CREATE TYPE "public"."order_submission_source" AS ENUM('manual', 'copilot', 'workflow');--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" DROP CONSTRAINT "workflow_execution_logs_workflow_id_workflow_id_fk";
--> statement-breakpoint
ALTER TABLE "workflow_execution_snapshots" DROP CONSTRAINT "workflow_execution_snapshots_workflow_id_workflow_id_fk";
--> statement-breakpoint
ALTER TABLE "workflow_log_webhook_delivery" DROP CONSTRAINT "workflow_log_webhook_delivery_subscription_id_workflow_log_webhook_id_fk";
--> statement-breakpoint
ALTER TABLE "workflow_log_webhook_delivery" DROP CONSTRAINT "workflow_log_webhook_delivery_workflow_id_workflow_id_fk";
--> statement-breakpoint
DROP INDEX "workflow_snapshots_workflow_hash_idx";--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ALTER COLUMN "workflow_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_execution_snapshots" ALTER COLUMN "workflow_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_log_webhook_delivery" ALTER COLUMN "subscription_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_log_webhook_delivery" ALTER COLUMN "workflow_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "orderHistoryTable" ADD COLUMN "workspace_id" text;--> statement-breakpoint
ALTER TABLE "orderHistoryTable" ADD COLUMN "submission_source" "order_submission_source";--> statement-breakpoint
ALTER TABLE "orderHistoryTable" ADD COLUMN "workflow_log_id" text;--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ADD COLUMN "workspace_id" text;--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ADD COLUMN "workflow_summary" jsonb;--> statement-breakpoint
ALTER TABLE "workflow_execution_snapshots" ADD COLUMN "workspace_id" text;--> statement-breakpoint
ALTER TABLE "workflow_log_webhook_delivery" ADD COLUMN "workspace_id" text;--> statement-breakpoint
ALTER TABLE "workflow_log_webhook_delivery" ADD COLUMN "workflow_summary" jsonb;--> statement-breakpoint
ALTER TABLE "workflow_log_webhook_delivery" ADD COLUMN "subscription_snapshot" jsonb;--> statement-breakpoint
UPDATE "orderHistoryTable" AS "order_history"
SET "workspace_id" = "workflow"."workspace_id"
FROM "workflow"
WHERE "order_history"."workflow_id" = "workflow"."id";--> statement-breakpoint
DELETE FROM "orderHistoryTable" WHERE "workspace_id" IS NULL;--> statement-breakpoint
UPDATE "orderHistoryTable" SET "submission_source" = 'workflow'::"order_submission_source";--> statement-breakpoint
UPDATE "workflow_execution_logs" AS "execution_log"
SET
  "workspace_id" = "workflow"."workspace_id",
  "workflow_summary" = jsonb_build_object(
    'id', "workflow"."id",
    'name', "workflow"."name",
    'description', "workflow"."description",
    'color', "workflow"."color",
    'folderId', "workflow"."folder_id",
    'userId', "workflow"."user_id",
    'workspaceId', "workflow"."workspace_id",
    'createdAt', "workflow"."created_at",
    'updatedAt', "workflow"."updated_at"
  )
FROM "workflow"
WHERE "execution_log"."workflow_id" = "workflow"."id";--> statement-breakpoint
UPDATE "workflow_execution_snapshots" AS "execution_snapshot"
SET "workspace_id" = "workflow"."workspace_id"
FROM "workflow"
WHERE "execution_snapshot"."workflow_id" = "workflow"."id";--> statement-breakpoint
UPDATE "workflow_log_webhook_delivery" AS "delivery"
SET
  "workspace_id" = "workflow"."workspace_id",
  "workflow_summary" = jsonb_build_object(
    'id', "workflow"."id",
    'name', "workflow"."name",
    'description', "workflow"."description",
    'color', "workflow"."color",
    'folderId', "workflow"."folder_id",
    'userId', "workflow"."user_id",
    'workspaceId', "workflow"."workspace_id",
    'createdAt', "workflow"."created_at",
    'updatedAt', "workflow"."updated_at"
  ),
  "subscription_snapshot" = jsonb_build_object(
    'url', "webhook"."url",
    'secret', "webhook"."secret",
    'includeFinalOutput', "webhook"."include_final_output",
    'includeTraceSpans', "webhook"."include_trace_spans",
    'includeRateLimits', "webhook"."include_rate_limits",
    'includeUsageData', "webhook"."include_usage_data"
  )
FROM "workflow", "workflow_log_webhook" AS "webhook"
WHERE "delivery"."workflow_id" = "workflow"."id"
  AND "delivery"."subscription_id" = "webhook"."id";--> statement-breakpoint
ALTER TABLE "orderHistoryTable" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "orderHistoryTable" ALTER COLUMN "submission_source" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ALTER COLUMN "workflow_summary" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_execution_snapshots" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_log_webhook_delivery" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_log_webhook_delivery" ALTER COLUMN "workflow_summary" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_log_webhook_delivery" ALTER COLUMN "subscription_snapshot" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "orderHistoryTable" ADD CONSTRAINT "orderHistoryTable_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orderHistoryTable" ADD CONSTRAINT "orderHistoryTable_workflow_log_id_workflow_execution_logs_id_fk" FOREIGN KEY ("workflow_log_id") REFERENCES "public"."workflow_execution_logs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ADD CONSTRAINT "workflow_execution_logs_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ADD CONSTRAINT "workflow_execution_logs_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_execution_snapshots" ADD CONSTRAINT "workflow_execution_snapshots_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_execution_snapshots" ADD CONSTRAINT "workflow_execution_snapshots_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_log_webhook_delivery" ADD CONSTRAINT "workflow_log_webhook_delivery_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_log_webhook_delivery" ADD CONSTRAINT "workflow_log_webhook_delivery_subscription_id_workflow_log_webhook_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."workflow_log_webhook"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_log_webhook_delivery" ADD CONSTRAINT "workflow_log_webhook_delivery_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_history_workspace_idx" ON "orderHistoryTable" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "order_history_workflow_log_idx" ON "orderHistoryTable" USING btree ("workflow_log_id");--> statement-breakpoint
CREATE INDEX "order_history_workspace_recorded_idx" ON "orderHistoryTable" USING btree ("workspace_id","recorded_at");--> statement-breakpoint
CREATE INDEX "workflow_execution_logs_workspace_id_idx" ON "workflow_execution_logs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "workflow_execution_logs_workspace_started_at_idx" ON "workflow_execution_logs" USING btree ("workspace_id","started_at");--> statement-breakpoint
CREATE INDEX "workflow_snapshots_workspace_id_idx" ON "workflow_execution_snapshots" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "workflow_log_webhook_delivery_workspace_id_idx" ON "workflow_log_webhook_delivery" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_snapshots_workflow_hash_idx" ON "workflow_execution_snapshots" USING btree ("workflow_id","workspace_id","state_hash");
