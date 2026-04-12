CREATE TABLE "organization_billing_ledger" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"total_manual_executions" integer DEFAULT 0 NOT NULL,
	"total_api_calls" integer DEFAULT 0 NOT NULL,
	"total_webhook_triggers" integer DEFAULT 0 NOT NULL,
	"total_scheduled_executions" integer DEFAULT 0 NOT NULL,
	"total_chat_executions" integer DEFAULT 0 NOT NULL,
	"total_tokens_used" integer DEFAULT 0 NOT NULL,
	"total_cost" numeric DEFAULT '0' NOT NULL,
	"current_period_cost" numeric DEFAULT '0' NOT NULL,
	"last_period_cost" numeric DEFAULT '0' NOT NULL,
	"billed_overage_this_period" numeric DEFAULT '0' NOT NULL,
	"total_copilot_cost" numeric DEFAULT '0' NOT NULL,
	"current_period_copilot_cost" numeric DEFAULT '0' NOT NULL,
	"last_period_copilot_cost" numeric DEFAULT '0' NOT NULL,
	"total_copilot_tokens" integer DEFAULT 0 NOT NULL,
	"total_copilot_calls" integer DEFAULT 0 NOT NULL,
	"billing_blocked" boolean DEFAULT false NOT NULL,
	"last_active" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_member_billing_ledger" (
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"total_manual_executions" integer DEFAULT 0 NOT NULL,
	"total_api_calls" integer DEFAULT 0 NOT NULL,
	"total_webhook_triggers" integer DEFAULT 0 NOT NULL,
	"total_scheduled_executions" integer DEFAULT 0 NOT NULL,
	"total_chat_executions" integer DEFAULT 0 NOT NULL,
	"total_tokens_used" integer DEFAULT 0 NOT NULL,
	"total_cost" numeric DEFAULT '0' NOT NULL,
	"current_period_cost" numeric DEFAULT '0' NOT NULL,
	"last_period_cost" numeric DEFAULT '0' NOT NULL,
	"total_copilot_cost" numeric DEFAULT '0' NOT NULL,
	"current_period_copilot_cost" numeric DEFAULT '0' NOT NULL,
	"last_period_copilot_cost" numeric DEFAULT '0' NOT NULL,
	"total_copilot_tokens" integer DEFAULT 0 NOT NULL,
	"total_copilot_calls" integer DEFAULT 0 NOT NULL,
	"last_active" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_member_billing_ledger_pkey" PRIMARY KEY("organization_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "system_billing_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"billing_enabled" boolean DEFAULT false NOT NULL,
	"allow_promotion_codes" boolean DEFAULT true NOT NULL,
	"onboarding_allowance_usd" numeric DEFAULT '0' NOT NULL,
	"overage_threshold_dollars" numeric DEFAULT '50' NOT NULL,
	"workflow_execution_charge_usd" numeric DEFAULT '0' NOT NULL,
	"function_execution_charge_usd" numeric DEFAULT '0' NOT NULL,
	"usage_warning_threshold_percent" integer DEFAULT 80 NOT NULL,
	"free_tier_upgrade_threshold_percent" integer DEFAULT 90 NOT NULL,
	"enterprise_contact_url" text,
	"updated_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "system_billing_settings_usage_warning_threshold_check" CHECK ("system_billing_settings"."usage_warning_threshold_percent" between 1 and 100),
	CONSTRAINT "system_billing_settings_onboarding_allowance_check" CHECK ("system_billing_settings"."onboarding_allowance_usd" >= 0),
	CONSTRAINT "system_billing_settings_workflow_execution_charge_check" CHECK ("system_billing_settings"."workflow_execution_charge_usd" >= 0),
	CONSTRAINT "system_billing_settings_function_execution_charge_check" CHECK ("system_billing_settings"."function_execution_charge_usd" >= 0),
	CONSTRAINT "system_billing_settings_free_tier_upgrade_threshold_check" CHECK ("system_billing_settings"."free_tier_upgrade_threshold_percent" between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "system_billing_tier" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"owner_type" text NOT NULL,
	"usage_scope" text NOT NULL,
	"seat_mode" text DEFAULT 'fixed' NOT NULL,
	"monthly_price_usd" numeric,
	"yearly_price_usd" numeric,
	"included_usage_limit_usd" numeric,
	"storage_limit_gb" integer,
	"concurrency_limit" integer,
	"seat_count" integer,
	"seat_maximum" integer,
	"stripe_monthly_price_id" text,
	"stripe_yearly_price_id" text,
	"stripe_product_id" text,
	"sync_rate_limit_per_minute" integer,
	"async_rate_limit_per_minute" integer,
	"api_endpoint_rate_limit_per_minute" integer,
	"can_edit_usage_limit" boolean DEFAULT false NOT NULL,
	"can_configure_sso" boolean DEFAULT false NOT NULL,
	"log_retention_days" integer,
	"workflow_model_cost_multiplier" numeric DEFAULT '1' NOT NULL,
	"function_execution_duration_multiplier" numeric DEFAULT '0' NOT NULL,
	"copilot_cost_multiplier" numeric DEFAULT '1' NOT NULL,
	"pricing_features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"updated_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "system_billing_tier_status_check" CHECK ("system_billing_tier"."status" in ('active', 'draft', 'archived')),
	CONSTRAINT "system_billing_tier_owner_type_check" CHECK ("system_billing_tier"."owner_type" in ('user', 'organization')),
	CONSTRAINT "system_billing_tier_usage_scope_check" CHECK ("system_billing_tier"."usage_scope" in ('individual', 'pooled')),
	CONSTRAINT "system_billing_tier_seat_mode_check" CHECK ("system_billing_tier"."seat_mode" in ('fixed', 'adjustable')),
	CONSTRAINT "system_billing_tier_seat_count_check" CHECK ("system_billing_tier"."seat_count" is null or "system_billing_tier"."seat_count" >= 1),
	CONSTRAINT "system_billing_tier_sync_rate_limit_check" CHECK ("system_billing_tier"."sync_rate_limit_per_minute" is null or "system_billing_tier"."sync_rate_limit_per_minute" >= 0),
	CONSTRAINT "system_billing_tier_async_rate_limit_check" CHECK ("system_billing_tier"."async_rate_limit_per_minute" is null or "system_billing_tier"."async_rate_limit_per_minute" >= 0),
	CONSTRAINT "system_billing_tier_api_endpoint_rate_limit_check" CHECK ("system_billing_tier"."api_endpoint_rate_limit_per_minute" is null or "system_billing_tier"."api_endpoint_rate_limit_per_minute" >= 0),
	CONSTRAINT "system_billing_tier_log_retention_days_check" CHECK ("system_billing_tier"."log_retention_days" is null or "system_billing_tier"."log_retention_days" >= 0),
	CONSTRAINT "system_billing_tier_workflow_model_cost_multiplier_check" CHECK ("system_billing_tier"."workflow_model_cost_multiplier" >= 0),
	CONSTRAINT "system_billing_tier_function_execution_duration_multiplier_check" CHECK ("system_billing_tier"."function_execution_duration_multiplier" >= 0),
	CONSTRAINT "system_billing_tier_copilot_cost_multiplier_check" CHECK ("system_billing_tier"."copilot_cost_multiplier" >= 0),
	CONSTRAINT "system_billing_tier_seat_range_check" CHECK ("system_billing_tier"."seat_maximum" is null or "system_billing_tier"."seat_count" is null or "system_billing_tier"."seat_maximum" >= "system_billing_tier"."seat_count"),
	CONSTRAINT "system_billing_tier_user_owner_shape_check" CHECK ("system_billing_tier"."owner_type" = 'organization' or ("system_billing_tier"."usage_scope" = 'individual' and "system_billing_tier"."seat_mode" = 'fixed' and "system_billing_tier"."seat_count" is null and "system_billing_tier"."seat_maximum" is null)),
	CONSTRAINT "system_billing_tier_org_seat_count_check" CHECK ("system_billing_tier"."owner_type" = 'user' or "system_billing_tier"."seat_count" is not null),
	CONSTRAINT "system_billing_tier_fixed_seat_maximum_check" CHECK ("system_billing_tier"."seat_mode" = 'adjustable' or "system_billing_tier"."seat_maximum" is null),
	CONSTRAINT "system_billing_tier_sso_owner_type_check" CHECK ("system_billing_tier"."owner_type" = 'organization' or "system_billing_tier"."can_configure_sso" = false)
);
--> statement-breakpoint
ALTER TABLE "user_stats" RENAME COLUMN "current_usage_limit" TO "custom_usage_limit";--> statement-breakpoint
ALTER TABLE "user_stats" RENAME COLUMN "usage_limit_updated_at" TO "custom_usage_limit_updated_at";--> statement-breakpoint
ALTER TABLE "workspace" RENAME COLUMN "billed_account_user_id" TO "billing_owner_user_id";--> statement-breakpoint
ALTER TABLE "subscription" DROP CONSTRAINT "check_enterprise_metadata";--> statement-breakpoint
ALTER TABLE "workspace" DROP CONSTRAINT "workspace_billed_account_user_id_user_id_fk";
--> statement-breakpoint
DROP INDEX "subscription_reference_status_idx";--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "billing_tier_id" text;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "reference_type" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN "granted_onboarding_allowance_usd" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "last_active" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "billing_owner_type" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "billing_owner_organization_id" text;--> statement-breakpoint
ALTER TABLE "organization_billing_ledger" ADD CONSTRAINT "organization_billing_ledger_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_member_billing_ledger" ADD CONSTRAINT "organization_member_billing_ledger_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_member_billing_ledger" ADD CONSTRAINT "organization_member_billing_ledger_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_billing_settings" ADD CONSTRAINT "system_billing_settings_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_billing_tier" ADD CONSTRAINT "system_billing_tier_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_billing_ledger_organization_id_idx" ON "organization_billing_ledger" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "organization_member_billing_ledger_organization_id_idx" ON "organization_member_billing_ledger" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "organization_member_billing_ledger_user_id_idx" ON "organization_member_billing_ledger" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "system_billing_settings_updated_by_user_id_idx" ON "system_billing_settings" USING btree ("updated_by_user_id");--> statement-breakpoint
CREATE INDEX "system_billing_tier_status_idx" ON "system_billing_tier" USING btree ("status");--> statement-breakpoint
CREATE INDEX "system_billing_tier_display_order_idx" ON "system_billing_tier" USING btree ("display_order");--> statement-breakpoint
CREATE INDEX "system_billing_tier_updated_by_user_id_idx" ON "system_billing_tier" USING btree ("updated_by_user_id");--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_billing_tier_id_system_billing_tier_id_fk" FOREIGN KEY ("billing_tier_id") REFERENCES "public"."system_billing_tier"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_billing_owner_user_id_user_id_fk" FOREIGN KEY ("billing_owner_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_billing_owner_organization_id_organization_id_fk" FOREIGN KEY ("billing_owner_organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subscription_billing_tier_id_idx" ON "subscription" USING btree ("billing_tier_id");--> statement-breakpoint
CREATE INDEX "subscription_reference_status_idx" ON "subscription" USING btree ("reference_type","reference_id","status");--> statement-breakpoint
ALTER TABLE "user_stats" DROP COLUMN "pro_period_cost_snapshot";--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_billing_owner_check" CHECK ((
        "workspace"."billing_owner_type" = 'user'
        AND "workspace"."billing_owner_user_id" IS NOT NULL
        AND "workspace"."billing_owner_organization_id" IS NULL
      ) OR (
        "workspace"."billing_owner_type" = 'organization'
        AND "workspace"."billing_owner_user_id" IS NULL
        AND "workspace"."billing_owner_organization_id" IS NOT NULL
      ));