ALTER TABLE "custom_tools" DROP CONSTRAINT "custom_tools_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "custom_tools" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "custom_tools" ADD COLUMN "workspace_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "custom_tools" ADD CONSTRAINT "custom_tools_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_tools" ADD CONSTRAINT "custom_tools_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "custom_tools_workspace_id_idx" ON "custom_tools" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_tools_workspace_title_unique" ON "custom_tools" USING btree ("workspace_id","title");