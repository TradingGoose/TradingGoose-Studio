ALTER TABLE "pending_execution" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "pending_execution" ALTER COLUMN "status" SET DEFAULT 'pending'::text;--> statement-breakpoint
DROP TYPE "public"."pending_execution_status";--> statement-breakpoint
CREATE TYPE "public"."pending_execution_status" AS ENUM('pending', 'processing');--> statement-breakpoint
ALTER TABLE "pending_execution" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."pending_execution_status";--> statement-breakpoint
ALTER TABLE "pending_execution" ALTER COLUMN "status" SET DATA TYPE "public"."pending_execution_status" USING "status"::"public"."pending_execution_status";--> statement-breakpoint
ALTER TABLE "pending_execution" DROP COLUMN "result";--> statement-breakpoint
ALTER TABLE "pending_execution" DROP COLUMN "completed_at";