ALTER TYPE "public"."webhook_delivery_status" ADD VALUE 'cancelled';--> statement-breakpoint
ALTER TABLE "orderHistoryTable" RENAME COLUMN "workflow_log_id" TO "log_id";--> statement-breakpoint
ALTER TABLE "orderHistoryTable" DROP CONSTRAINT "orderHistoryTable_workflow_id_workflow_id_fk";
--> statement-breakpoint
ALTER TABLE "orderHistoryTable" DROP CONSTRAINT "orderHistoryTable_workflow_log_id_workflow_execution_logs_id_fk";
--> statement-breakpoint
DROP INDEX "order_history_workflow_idx";--> statement-breakpoint
DROP INDEX "order_history_workflow_log_idx";--> statement-breakpoint
DROP INDEX "order_history_execution_idx";--> statement-breakpoint
DROP INDEX "order_history_workflow_recorded_idx";--> statement-breakpoint
ALTER TABLE "orderHistoryTable" ADD CONSTRAINT "orderHistoryTable_log_id_workflow_execution_logs_id_fk" FOREIGN KEY ("log_id") REFERENCES "public"."workflow_execution_logs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_history_log_idx" ON "orderHistoryTable" USING btree ("log_id");--> statement-breakpoint
ALTER TABLE "orderHistoryTable" DROP COLUMN "workflow_id";--> statement-breakpoint
ALTER TABLE "orderHistoryTable" DROP COLUMN "workflow_execution_id";