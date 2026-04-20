CREATE TYPE "public"."registration_mode" AS ENUM('open', 'waitlist', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."waitlist_status" AS ENUM('pending', 'approved', 'rejected', 'signed_up');--> statement-breakpoint
CREATE TABLE "system_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"registration_mode" "registration_mode" DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "waitlist" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."waitlist_status";--> statement-breakpoint
ALTER TABLE "waitlist" ALTER COLUMN "status" SET DATA TYPE "public"."waitlist_status" USING "status"::"public"."waitlist_status";--> statement-breakpoint
ALTER TABLE "waitlist" ADD COLUMN "approved_at" timestamp;--> statement-breakpoint
ALTER TABLE "waitlist" ADD COLUMN "approved_by_user_id" text;--> statement-breakpoint
ALTER TABLE "waitlist" ADD COLUMN "rejected_at" timestamp;--> statement-breakpoint
ALTER TABLE "waitlist" ADD COLUMN "rejected_by_user_id" text;--> statement-breakpoint
ALTER TABLE "waitlist" ADD COLUMN "signed_up_at" timestamp;--> statement-breakpoint
ALTER TABLE "waitlist" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_approved_by_user_id_user_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_rejected_by_user_id_user_id_fk" FOREIGN KEY ("rejected_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "waitlist_email_idx" ON "waitlist" USING btree ("email");--> statement-breakpoint
CREATE INDEX "waitlist_status_idx" ON "waitlist" USING btree ("status");--> statement-breakpoint
CREATE INDEX "waitlist_user_id_idx" ON "waitlist" USING btree ("user_id");