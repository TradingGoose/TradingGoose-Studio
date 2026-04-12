ALTER TABLE "system_settings" ADD COLUMN "billing_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "allow_promotion_codes" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "stripe_secret_key" text;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "stripe_webhook_secret" text;--> statement-breakpoint
ALTER TABLE "system_billing_settings" DROP COLUMN "billing_enabled";--> statement-breakpoint
ALTER TABLE "system_billing_settings" DROP COLUMN "allow_promotion_codes";