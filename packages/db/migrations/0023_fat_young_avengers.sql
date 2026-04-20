CREATE TABLE "system_service_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"service" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_service_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"service" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "email_domain" text DEFAULT 'tradinggoose.ai' NOT NULL;--> statement-breakpoint
ALTER TABLE "system_settings" ADD COLUMN "from_email_address" text;--> statement-breakpoint
CREATE INDEX "system_service_credentials_service_idx" ON "system_service_credentials" USING btree ("service");--> statement-breakpoint
CREATE UNIQUE INDEX "system_service_credentials_service_key_unique" ON "system_service_credentials" USING btree ("service","key");--> statement-breakpoint
CREATE INDEX "system_service_settings_service_idx" ON "system_service_settings" USING btree ("service");--> statement-breakpoint
CREATE UNIQUE INDEX "system_service_settings_service_key_unique" ON "system_service_settings" USING btree ("service","key");--> statement-breakpoint
ALTER TABLE "system_settings" DROP COLUMN "stripe_secret_key";--> statement-breakpoint
ALTER TABLE "system_settings" DROP COLUMN "stripe_webhook_secret";