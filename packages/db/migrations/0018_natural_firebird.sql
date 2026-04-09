CREATE TABLE "integration_binding" (
	"id" text PRIMARY KEY NOT NULL,
	"definition_id" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_admin" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_integration_definition" (
	"id" text PRIMARY KEY NOT NULL,
	"parent_id" text,
	"name" text NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "system_integration_definition_parent_check" CHECK ("system_integration_definition"."parent_id" is null or "system_integration_definition"."parent_id" <> "system_integration_definition"."id")
);
--> statement-breakpoint
CREATE TABLE "system_integration_secret" (
	"id" text PRIMARY KEY NOT NULL,
	"definition_id" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integration_binding" ADD CONSTRAINT "integration_binding_definition_id_system_integration_definition_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."system_integration_definition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_admin" ADD CONSTRAINT "system_admin_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_integration_definition" ADD CONSTRAINT "system_integration_definition_parent_id_system_integration_definition_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."system_integration_definition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_integration_secret" ADD CONSTRAINT "system_integration_secret_definition_id_system_integration_definition_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."system_integration_definition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integration_binding_definition_id_idx" ON "integration_binding" USING btree ("definition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_binding_subject_unique" ON "integration_binding" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "system_admin_user_id_unique" ON "system_admin" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "system_integration_definition_parent_id_idx" ON "system_integration_definition" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "system_integration_secret_definition_id_idx" ON "system_integration_secret" USING btree ("definition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "system_integration_secret_definition_key_unique" ON "system_integration_secret" USING btree ("definition_id","key");