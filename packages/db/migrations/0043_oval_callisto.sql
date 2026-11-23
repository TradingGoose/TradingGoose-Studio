ALTER TABLE "user" RENAME COLUMN "name" TO "display_name";--> statement-breakpoint
ALTER TABLE "sso_provider" ADD COLUMN "domain_verified" boolean;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "cancel_at" timestamp;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "canceled_at" timestamp;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "ended_at" timestamp;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "billing_interval" text;--> statement-breakpoint
ALTER TABLE "subscription" ADD COLUMN "stripe_schedule_id" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_username_unique" UNIQUE("username");