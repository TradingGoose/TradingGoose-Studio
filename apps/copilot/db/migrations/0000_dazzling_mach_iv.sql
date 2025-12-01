CREATE TABLE "copilot_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_suffix" text,
	"created_at" timestamp NOT NULL
);
