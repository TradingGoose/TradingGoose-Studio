ALTER TABLE "system_billing_tier" RENAME COLUMN "function_execution_duration_multiplier" TO "function_execution_multiplier";--> statement-breakpoint
ALTER TABLE "system_billing_tier" DROP CONSTRAINT "system_billing_tier_function_execution_duration_multiplier_check";--> statement-breakpoint
ALTER TABLE "system_billing_tier" ADD COLUMN "workflow_execution_multiplier" numeric DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "system_billing_tier" ADD CONSTRAINT "system_billing_tier_workflow_execution_multiplier_check" CHECK ("system_billing_tier"."workflow_execution_multiplier" >= 0);--> statement-breakpoint
ALTER TABLE "system_billing_tier" ADD CONSTRAINT "system_billing_tier_function_execution_multiplier_check" CHECK ("system_billing_tier"."function_execution_multiplier" >= 0);