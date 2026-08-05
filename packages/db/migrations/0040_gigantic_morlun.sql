CREATE TYPE "public"."workflow_execution_attempt_state" AS ENUM('processing', 'canceled', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."workflow_execution_operation_capability" AS ENUM('local', 'native_cancel_status', 'status_only', 'uncancelable');--> statement-breakpoint
CREATE TYPE "public"."workflow_execution_operation_state" AS ENUM('registered', 'running', 'cancel_requested', 'canceled', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."workflow_execution_outbox_state" AS ENUM('pending', 'claimed', 'completed');--> statement-breakpoint
CREATE TYPE "public"."workflow_execution_participant_state" AS ENUM('active', 'waiting_child', 'canceled', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."workflow_execution_policy_state" AS ENUM('uncaptured', 'bounded', 'unlimited');--> statement-breakpoint
CREATE TYPE "public"."workflow_execution_terminal_state" AS ENUM('running', 'termination_pending', 'terminal');--> statement-breakpoint
CREATE TABLE "private_tier_access" (
	"user_id" text NOT NULL,
	"tier_id" text NOT NULL,
	CONSTRAINT "private_tier_access_user_tier_pkey" PRIMARY KEY("user_id","tier_id")
);
--> statement-breakpoint
CREATE TABLE "workflow_execution_attempt" (
	"id" text PRIMARY KEY NOT NULL,
	"root_execution_id" text NOT NULL,
	"pending_execution_id" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"drain_run_id" text,
	"state" "workflow_execution_attempt_state" DEFAULT 'processing' NOT NULL,
	"processing_started_at" timestamp (6) with time zone NOT NULL,
	"processing_completed_at" timestamp (6) with time zone,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_execution_attempt_lifecycle_shape_check" CHECK ("workflow_execution_attempt"."attempt_number" > 0 and (
        ("workflow_execution_attempt"."state" = 'processing' and "workflow_execution_attempt"."processing_completed_at" is null)
        or ("workflow_execution_attempt"."state" in ('canceled', 'completed', 'failed') and "workflow_execution_attempt"."processing_completed_at" is not null and "workflow_execution_attempt"."processing_completed_at" >= "workflow_execution_attempt"."processing_started_at")
      ))
);
--> statement-breakpoint
CREATE TABLE "workflow_execution_deadline" (
	"root_execution_id" text PRIMARY KEY NOT NULL,
	"actor_user_id" text,
	"trigger_type" text NOT NULL,
	"applied_tier_id" text NOT NULL,
	"processing_started_at" timestamp (6) with time zone NOT NULL,
	"limit_seconds" numeric NOT NULL,
	"limit_microseconds" numeric NOT NULL,
	"counted_microseconds" numeric DEFAULT '0' NOT NULL,
	"last_accounted_at" timestamp (6) with time zone NOT NULL,
	"next_reconcile_at" timestamp (6) with time zone,
	"schedule_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_execution_deadline_ledger_shape_check" CHECK ("workflow_execution_deadline"."limit_seconds" > 0
        and "workflow_execution_deadline"."limit_seconds" < 'Infinity'::numeric
        and "workflow_execution_deadline"."limit_microseconds" > 0
        and scale("workflow_execution_deadline"."limit_microseconds") = 0
        and "workflow_execution_deadline"."counted_microseconds" >= 0
        and scale("workflow_execution_deadline"."counted_microseconds") = 0
        and "workflow_execution_deadline"."counted_microseconds" <= "workflow_execution_deadline"."limit_microseconds"
        and "workflow_execution_deadline"."schedule_version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "workflow_execution_operation" (
	"id" text PRIMARY KEY NOT NULL,
	"root_execution_id" text NOT NULL,
	"execution_id" text NOT NULL,
	"attempt_id" text NOT NULL,
	"participant_id" text,
	"block_id" text,
	"handler_type" text NOT NULL,
	"adapter_kind" text NOT NULL,
	"capability" "workflow_execution_operation_capability" NOT NULL,
	"state" "workflow_execution_operation_state" DEFAULT 'registered' NOT NULL,
	"remote_operation_id" text,
	"observation" jsonb,
	"last_observed_at" timestamp (6) with time zone,
	"next_reconcile_at" timestamp (6) with time zone,
	"lease_expires_at" timestamp (6) with time zone,
	"fencing_token" text,
	"terminal_at" timestamp (6) with time zone,
	"result" jsonb,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_execution_operation_lifecycle_shape_check" CHECK ((
        ("workflow_execution_operation"."state" in ('registered', 'running', 'cancel_requested') and "workflow_execution_operation"."terminal_at" is null)
        or ("workflow_execution_operation"."state" in ('canceled', 'completed', 'failed') and "workflow_execution_operation"."terminal_at" is not null)
      ) and (("workflow_execution_operation"."lease_expires_at" is null) = ("workflow_execution_operation"."fencing_token" is null)))
);
--> statement-breakpoint
CREATE TABLE "workflow_execution_outbox" (
	"root_execution_id" text NOT NULL,
	"kind" text NOT NULL,
	"version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"state" "workflow_execution_outbox_state" DEFAULT 'pending' NOT NULL,
	"available_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"claim_expires_at" timestamp (6) with time zone,
	"fencing_token" text,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp (6) with time zone,
	CONSTRAINT "workflow_execution_outbox_pkey" PRIMARY KEY("root_execution_id","kind","version"),
	CONSTRAINT "workflow_execution_outbox_lifecycle_shape_check" CHECK ("workflow_execution_outbox"."version" >= 0 and "workflow_execution_outbox"."attempt_count" >= 0 and (
        ("workflow_execution_outbox"."state" = 'pending' and "workflow_execution_outbox"."claim_expires_at" is null and "workflow_execution_outbox"."fencing_token" is null and "workflow_execution_outbox"."completed_at" is null)
        or ("workflow_execution_outbox"."state" = 'claimed' and "workflow_execution_outbox"."claim_expires_at" is not null and "workflow_execution_outbox"."fencing_token" is not null and "workflow_execution_outbox"."completed_at" is null)
        or ("workflow_execution_outbox"."state" = 'completed' and "workflow_execution_outbox"."claim_expires_at" is null and "workflow_execution_outbox"."completed_at" is not null)
      ))
);
--> statement-breakpoint
CREATE TABLE "workflow_execution_participant" (
	"id" text PRIMARY KEY NOT NULL,
	"root_execution_id" text NOT NULL,
	"attempt_id" text NOT NULL,
	"pending_execution_id" text NOT NULL,
	"state" "workflow_execution_participant_state" DEFAULT 'active' NOT NULL,
	"lease_expires_at" timestamp (6) with time zone NOT NULL,
	"last_heartbeat_at" timestamp (6) with time zone NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_execution_participant_lease_order_check" CHECK ("workflow_execution_participant"."lease_expires_at" >= "workflow_execution_participant"."last_heartbeat_at")
);
--> statement-breakpoint
CREATE TABLE "workflow_execution_terminal" (
	"root_execution_id" text PRIMARY KEY NOT NULL,
	"workflow_id" text,
	"workspace_id" text,
	"actor_user_id" text,
	"policy_state" "workflow_execution_policy_state" DEFAULT 'uncaptured' NOT NULL,
	"state" "workflow_execution_terminal_state" DEFAULT 'running' NOT NULL,
	"dispatch_open" boolean DEFAULT true NOT NULL,
	"applied_tier_id" text,
	"applied_tier_name" text,
	"limit_seconds" numeric,
	"processing_started_at" timestamp (6) with time zone,
	"termination_requested_at" timestamp (6) with time zone,
	"deadline_candidate_at" timestamp (6) with time zone,
	"cancellation_candidate_at" timestamp (6) with time zone,
	"infrastructure_candidate_at" timestamp (6) with time zone,
	"infrastructure_diagnostics" jsonb,
	"late_application_result" jsonb,
	"barrier_version" integer DEFAULT 0 NOT NULL,
	"winning_cause" text,
	"result" jsonb,
	"result_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_execution_terminal_policy_shape_check" CHECK ((
        ("workflow_execution_terminal"."policy_state" = 'uncaptured' and "workflow_execution_terminal"."applied_tier_id" is null and "workflow_execution_terminal"."applied_tier_name" is null and "workflow_execution_terminal"."processing_started_at" is null and "workflow_execution_terminal"."limit_seconds" is null)
        or ("workflow_execution_terminal"."policy_state" = 'unlimited' and "workflow_execution_terminal"."applied_tier_id" is not null and "workflow_execution_terminal"."applied_tier_name" is not null and "workflow_execution_terminal"."processing_started_at" is not null and "workflow_execution_terminal"."limit_seconds" is null)
        or ("workflow_execution_terminal"."policy_state" = 'bounded' and "workflow_execution_terminal"."applied_tier_id" is not null and "workflow_execution_terminal"."applied_tier_name" is not null and "workflow_execution_terminal"."processing_started_at" is not null and "workflow_execution_terminal"."limit_seconds" > 0 and "workflow_execution_terminal"."limit_seconds" < 'Infinity'::numeric)
      )),
	CONSTRAINT "workflow_execution_terminal_lifecycle_shape_check" CHECK ((
        ("workflow_execution_terminal"."state" = 'running' and "workflow_execution_terminal"."dispatch_open" and "workflow_execution_terminal"."result" is null)
        or ("workflow_execution_terminal"."state" = 'termination_pending' and not "workflow_execution_terminal"."dispatch_open" and "workflow_execution_terminal"."result" is null)
        or ("workflow_execution_terminal"."state" = 'terminal' and not "workflow_execution_terminal"."dispatch_open" and "workflow_execution_terminal"."result" is not null and "workflow_execution_terminal"."winning_cause" in ('application', 'deadline', 'cancellation', 'infrastructure') and "workflow_execution_terminal"."result_version" > 0)
      ) and "workflow_execution_terminal"."barrier_version" >= 0 and "workflow_execution_terminal"."result_version" >= 0
        and ("workflow_execution_terminal"."deadline_candidate_at" is null or "workflow_execution_terminal"."policy_state" = 'bounded'))
);
--> statement-breakpoint
ALTER TABLE "system_billing_tier" ADD COLUMN "access_code" text;--> statement-breakpoint
ALTER TABLE "system_billing_tier" ADD COLUMN "workflow_execution_time_limit_seconds" numeric;--> statement-breakpoint
ALTER TABLE "private_tier_access" ADD CONSTRAINT "private_tier_access_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_tier_access" ADD CONSTRAINT "private_tier_access_tier_id_system_billing_tier_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."system_billing_tier"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_execution_attempt" ADD CONSTRAINT "workflow_execution_attempt_root_execution_id_workflow_execution_terminal_root_execution_id_fk" FOREIGN KEY ("root_execution_id") REFERENCES "public"."workflow_execution_terminal"("root_execution_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_execution_deadline" ADD CONSTRAINT "workflow_execution_deadline_root_execution_id_workflow_execution_terminal_root_execution_id_fk" FOREIGN KEY ("root_execution_id") REFERENCES "public"."workflow_execution_terminal"("root_execution_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_execution_deadline" ADD CONSTRAINT "workflow_execution_deadline_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_execution_operation" ADD CONSTRAINT "workflow_execution_operation_root_execution_id_workflow_execution_terminal_root_execution_id_fk" FOREIGN KEY ("root_execution_id") REFERENCES "public"."workflow_execution_terminal"("root_execution_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_execution_operation" ADD CONSTRAINT "workflow_execution_operation_attempt_id_workflow_execution_attempt_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."workflow_execution_attempt"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_execution_operation" ADD CONSTRAINT "workflow_execution_operation_participant_id_workflow_execution_participant_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."workflow_execution_participant"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_execution_outbox" ADD CONSTRAINT "workflow_execution_outbox_root_execution_id_workflow_execution_terminal_root_execution_id_fk" FOREIGN KEY ("root_execution_id") REFERENCES "public"."workflow_execution_terminal"("root_execution_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_execution_participant" ADD CONSTRAINT "workflow_execution_participant_root_execution_id_workflow_execution_terminal_root_execution_id_fk" FOREIGN KEY ("root_execution_id") REFERENCES "public"."workflow_execution_terminal"("root_execution_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_execution_participant" ADD CONSTRAINT "workflow_execution_participant_attempt_id_workflow_execution_attempt_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."workflow_execution_attempt"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_execution_terminal" ADD CONSTRAINT "workflow_execution_terminal_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_execution_terminal" ADD CONSTRAINT "workflow_execution_terminal_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_execution_terminal" ADD CONSTRAINT "workflow_execution_terminal_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "private_tier_access_user_id_idx" ON "private_tier_access" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "private_tier_access_tier_id_idx" ON "private_tier_access" USING btree ("tier_id");--> statement-breakpoint
CREATE INDEX "workflow_execution_attempt_root_idx" ON "workflow_execution_attempt" USING btree ("root_execution_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_execution_attempt_pending_number_unique" ON "workflow_execution_attempt" USING btree ("pending_execution_id","attempt_number");--> statement-breakpoint
CREATE INDEX "workflow_execution_attempt_open_idx" ON "workflow_execution_attempt" USING btree ("processing_completed_at");--> statement-breakpoint
CREATE INDEX "workflow_execution_deadline_due_idx" ON "workflow_execution_deadline" USING btree ("next_reconcile_at");--> statement-breakpoint
CREATE INDEX "workflow_execution_operation_root_state_idx" ON "workflow_execution_operation" USING btree ("root_execution_id","state");--> statement-breakpoint
CREATE INDEX "workflow_execution_operation_lease_idx" ON "workflow_execution_operation" USING btree ("lease_expires_at");--> statement-breakpoint
CREATE INDEX "workflow_execution_outbox_state_idx" ON "workflow_execution_outbox" USING btree ("state","available_at","claim_expires_at");--> statement-breakpoint
CREATE INDEX "workflow_execution_participant_root_idx" ON "workflow_execution_participant" USING btree ("root_execution_id");--> statement-breakpoint
CREATE INDEX "workflow_execution_participant_lease_idx" ON "workflow_execution_participant" USING btree ("lease_expires_at");--> statement-breakpoint
CREATE INDEX "workflow_execution_terminal_state_idx" ON "workflow_execution_terminal" USING btree ("state");--> statement-breakpoint
CREATE INDEX "workflow_execution_terminal_workspace_idx" ON "workflow_execution_terminal" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "system_billing_tier_access_code_unique" ON "system_billing_tier" USING btree ("access_code") WHERE "system_billing_tier"."access_code" is not null;--> statement-breakpoint
ALTER TABLE "system_billing_tier" ADD CONSTRAINT "system_billing_tier_public_access_code_check" CHECK (not "system_billing_tier"."is_public" or "system_billing_tier"."access_code" is null);--> statement-breakpoint
ALTER TABLE "system_billing_tier" ADD CONSTRAINT "system_billing_tier_access_code_not_blank_check" CHECK ("system_billing_tier"."access_code" is null or ("system_billing_tier"."access_code" = btrim("system_billing_tier"."access_code") and length("system_billing_tier"."access_code") > 0));--> statement-breakpoint
ALTER TABLE "system_billing_tier" ADD CONSTRAINT "system_billing_tier_workflow_execution_time_limit_check" CHECK ("system_billing_tier"."workflow_execution_time_limit_seconds" is null or ("system_billing_tier"."workflow_execution_time_limit_seconds" > 0 and "system_billing_tier"."workflow_execution_time_limit_seconds" <> 'NaN'::numeric and "system_billing_tier"."workflow_execution_time_limit_seconds" <> 'Infinity'::numeric and "system_billing_tier"."workflow_execution_time_limit_seconds" <> '-Infinity'::numeric));