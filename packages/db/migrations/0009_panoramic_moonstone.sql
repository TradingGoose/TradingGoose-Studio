ALTER TABLE "pine_indicators" RENAME TO "custom_indicators";--> statement-breakpoint
ALTER TABLE "custom_indicators" DROP CONSTRAINT "pine_indicators_workspace_id_workspace_id_fk";
--> statement-breakpoint
ALTER TABLE "custom_indicators" DROP CONSTRAINT "pine_indicators_user_id_user_id_fk";
--> statement-breakpoint
DROP INDEX "pine_indicators_workspace_id_idx";--> statement-breakpoint
ALTER TABLE "custom_indicators" ADD CONSTRAINT "custom_indicators_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_indicators" ADD CONSTRAINT "custom_indicators_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "custom_indicators_workspace_id_idx" ON "custom_indicators" USING btree ("workspace_id");