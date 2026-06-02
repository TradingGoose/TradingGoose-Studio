ALTER TABLE "settings" ADD COLUMN "preferred_locale" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "waitlist" ADD COLUMN "preferred_locale" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "pending_execution" DROP COLUMN "attempts";--> statement-breakpoint
ALTER TABLE "pending_execution" DROP COLUMN "error_message";