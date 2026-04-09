ALTER TABLE "integration_binding" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "integration_binding" CASCADE;--> statement-breakpoint
ALTER TABLE "system_integration_definition" ALTER COLUMN "is_enabled" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "system_integration_definition" ALTER COLUMN "is_enabled" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "system_integration_definition" ADD CONSTRAINT "system_integration_definition_availability_check" CHECK (("system_integration_definition"."parent_id" is null and "system_integration_definition"."is_enabled" is null) or ("system_integration_definition"."parent_id" is not null and "system_integration_definition"."is_enabled" is not null));