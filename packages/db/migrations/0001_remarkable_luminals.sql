ALTER TABLE "user_stats" ADD COLUMN IF NOT EXISTS "current_period_copilot_cost" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_stats" ADD COLUMN IF NOT EXISTS "last_period_copilot_cost" numeric DEFAULT '0';
