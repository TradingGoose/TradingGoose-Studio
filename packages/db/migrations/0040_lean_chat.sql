CREATE TABLE "private_tier_access" (
	"user_id" text NOT NULL,
	"billing_tier_id" text NOT NULL,
	CONSTRAINT "private_tier_access_pkey" PRIMARY KEY("user_id","billing_tier_id")
);
--> statement-breakpoint
ALTER TABLE "system_billing_tier" ADD COLUMN "access_code" text;--> statement-breakpoint
ALTER TABLE "system_billing_tier" ADD COLUMN "workflow_execution_time_limit_seconds" integer;--> statement-breakpoint
ALTER TABLE "private_tier_access" ADD CONSTRAINT "private_tier_access_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_tier_access" ADD CONSTRAINT "private_tier_access_billing_tier_id_system_billing_tier_id_fk" FOREIGN KEY ("billing_tier_id") REFERENCES "public"."system_billing_tier"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "private_tier_access_billing_tier_id_idx" ON "private_tier_access" USING btree ("billing_tier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "system_billing_tier_access_code_unique" ON "system_billing_tier" USING btree ("access_code");--> statement-breakpoint
CREATE UNIQUE INDEX "system_billing_tier_stripe_monthly_price_id_unique" ON "system_billing_tier" USING btree ("stripe_monthly_price_id");--> statement-breakpoint
CREATE UNIQUE INDEX "system_billing_tier_stripe_yearly_price_id_unique" ON "system_billing_tier" USING btree ("stripe_yearly_price_id");--> statement-breakpoint
CREATE UNIQUE INDEX "system_billing_tier_stripe_product_id_unique" ON "system_billing_tier" USING btree ("stripe_product_id");--> statement-breakpoint
ALTER TABLE "system_billing_tier" ADD CONSTRAINT "system_billing_tier_access_code_check" CHECK ("system_billing_tier"."access_code" is null or (not "system_billing_tier"."is_public" and "system_billing_tier"."access_code" = btrim("system_billing_tier"."access_code")));--> statement-breakpoint
ALTER TABLE "system_billing_tier" ADD CONSTRAINT "system_billing_tier_stripe_price_ids_distinct_check" CHECK ("system_billing_tier"."stripe_monthly_price_id" is null or "system_billing_tier"."stripe_yearly_price_id" is null or "system_billing_tier"."stripe_monthly_price_id" <> "system_billing_tier"."stripe_yearly_price_id");--> statement-breakpoint
ALTER TABLE "system_billing_tier" ADD CONSTRAINT "system_billing_tier_workflow_execution_time_limit_check" CHECK ("system_billing_tier"."workflow_execution_time_limit_seconds" is null or "system_billing_tier"."workflow_execution_time_limit_seconds" between 5 and 2147483);