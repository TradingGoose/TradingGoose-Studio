CREATE UNIQUE INDEX "subscription_stripe_subscription_id_unique" ON "subscription" USING btree ("stripe_subscription_id");--> statement-breakpoint
ALTER TABLE "copilot_review_items" DROP COLUMN "tool_calls";
