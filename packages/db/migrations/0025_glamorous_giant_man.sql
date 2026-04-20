ALTER TABLE "system_settings" ADD COLUMN "trigger_dev_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN "auto_connect";--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN "auto_fill_env_vars";--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN "auto_pan";--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN "console_expanded_by_default";--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN "show_floating_controls";--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN "show_training_controls";--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN "copilot_auto_allowed_tools";