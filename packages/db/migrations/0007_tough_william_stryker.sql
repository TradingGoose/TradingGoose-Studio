CREATE TABLE "orderHistoryTable" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"environment" text,
	"recorded_at" timestamp DEFAULT now() NOT NULL,
	"workflow_id" text,
	"workflow_execution_id" text,
	"listing_id" text,
	"listing_key" text,
	"listing_type" text,
	"listing_identity" jsonb,
	"request" jsonb NOT NULL,
	"response" jsonb NOT NULL,
	"normalized_order" jsonb
);
--> statement-breakpoint
ALTER TABLE "orderHistoryTable" ADD CONSTRAINT "orderHistoryTable_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_history_provider_idx" ON "orderHistoryTable" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "order_history_workflow_idx" ON "orderHistoryTable" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "order_history_execution_idx" ON "orderHistoryTable" USING btree ("workflow_execution_id");--> statement-breakpoint
CREATE INDEX "order_history_recorded_at_idx" ON "orderHistoryTable" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "order_history_workflow_recorded_idx" ON "orderHistoryTable" USING btree ("workflow_id","recorded_at");