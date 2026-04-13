CREATE TYPE "public"."system_service_value_kind" AS ENUM('credential', 'setting');--> statement-breakpoint
CREATE TABLE "system_service_values" (
	"id" text PRIMARY KEY NOT NULL,
	"service" text NOT NULL,
	"kind" "system_service_value_kind" NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP TABLE "system_service_credentials" CASCADE;--> statement-breakpoint
DROP TABLE "system_service_settings" CASCADE;--> statement-breakpoint
CREATE INDEX "system_service_values_service_idx" ON "system_service_values" USING btree ("service");--> statement-breakpoint
CREATE INDEX "system_service_values_service_kind_idx" ON "system_service_values" USING btree ("service","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "system_service_values_service_kind_key_unique" ON "system_service_values" USING btree ("service","kind","key");