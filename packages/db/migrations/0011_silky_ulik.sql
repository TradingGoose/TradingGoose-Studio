CREATE TABLE "environment_variables" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"workspace_id" text,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "environment_variables_scope_check" CHECK ((user_id IS NOT NULL AND workspace_id IS NULL) OR (user_id IS NULL AND workspace_id IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "environment_variables" ADD CONSTRAINT "environment_variables_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_variables" ADD CONSTRAINT "environment_variables_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "environment_variables_user_id_idx" ON "environment_variables" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "environment_variables_workspace_id_idx" ON "environment_variables" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "environment_variables_user_key_unique" ON "environment_variables" USING btree ("user_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "environment_variables_workspace_key_unique" ON "environment_variables" USING btree ("workspace_id","key");