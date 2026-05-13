CREATE TYPE "public"."credential_member_role" AS ENUM('admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."credential_member_status" AS ENUM('active', 'pending', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."credential_type" AS ENUM('oauth', 'env_workspace', 'env_personal', 'service_account');--> statement-breakpoint
CREATE TABLE "credential" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"type" "credential_type" NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"provider_id" text,
	"account_id" text,
	"env_key" text,
	"env_owner_user_id" text,
	"encrypted_service_account_key" text,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "credential_oauth_source_check" CHECK ((type <> 'oauth') OR (account_id IS NOT NULL AND provider_id IS NOT NULL)),
	CONSTRAINT "credential_workspace_env_source_check" CHECK ((type <> 'env_workspace') OR (env_key IS NOT NULL AND env_owner_user_id IS NULL)),
	CONSTRAINT "credential_personal_env_source_check" CHECK ((type <> 'env_personal') OR (env_key IS NOT NULL AND env_owner_user_id IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "credential_member" (
	"id" text PRIMARY KEY NOT NULL,
	"credential_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "credential_member_role" DEFAULT 'member' NOT NULL,
	"status" "credential_member_status" DEFAULT 'active' NOT NULL,
	"joined_at" timestamp,
	"invited_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credential" ADD CONSTRAINT "credential_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential" ADD CONSTRAINT "credential_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential" ADD CONSTRAINT "credential_env_owner_user_id_user_id_fk" FOREIGN KEY ("env_owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential" ADD CONSTRAINT "credential_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_member" ADD CONSTRAINT "credential_member_credential_id_credential_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credential"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_member" ADD CONSTRAINT "credential_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_member" ADD CONSTRAINT "credential_member_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credential_workspace_id_idx" ON "credential" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "credential_type_idx" ON "credential" USING btree ("type");--> statement-breakpoint
CREATE INDEX "credential_provider_id_idx" ON "credential" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "credential_account_id_idx" ON "credential" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "credential_env_owner_user_id_idx" ON "credential" USING btree ("env_owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credential_workspace_account_unique" ON "credential" USING btree ("workspace_id","account_id") WHERE account_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "credential_workspace_env_unique" ON "credential" USING btree ("workspace_id","type","env_key") WHERE type = 'env_workspace';--> statement-breakpoint
CREATE UNIQUE INDEX "credential_workspace_personal_env_unique" ON "credential" USING btree ("workspace_id","type","env_key","env_owner_user_id") WHERE type = 'env_personal';--> statement-breakpoint
CREATE INDEX "credential_member_user_id_idx" ON "credential_member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "credential_member_role_idx" ON "credential_member" USING btree ("role");--> statement-breakpoint
CREATE INDEX "credential_member_status_idx" ON "credential_member" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "credential_member_unique" ON "credential_member" USING btree ("credential_id","user_id");