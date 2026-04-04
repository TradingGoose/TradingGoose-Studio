CREATE TABLE "copilot_review_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"turn_id" uuid,
	"sequence" integer NOT NULL,
	"item_id" text NOT NULL,
	"kind" text DEFAULT 'message' NOT NULL,
	"message_role" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"timestamp" text NOT NULL,
	"tool_calls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content_blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"contexts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"file_attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "copilot_review_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text,
	"entity_kind" text NOT NULL,
	"entity_id" text,
	"draft_session_id" text,
	"session_scope_key" text,
	"user_id" text NOT NULL,
	"title" text,
	"model" text NOT NULL,
	"conversation_id" text,
	"preview_yaml" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "copilot_review_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"user_message_item_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "copilot_chats" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "copilot_chats" CASCADE;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "command" text;--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "args" jsonb DEFAULT '[]';--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN "env" jsonb DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "workflow_blocks" ADD COLUMN "layout" jsonb DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "copilot_review_items" ADD CONSTRAINT "copilot_review_items_session_id_copilot_review_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."copilot_review_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_review_items" ADD CONSTRAINT "copilot_review_items_turn_id_copilot_review_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."copilot_review_turns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_review_sessions" ADD CONSTRAINT "copilot_review_sessions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_review_turns" ADD CONSTRAINT "copilot_review_turns_session_id_copilot_review_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."copilot_review_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "copilot_review_items_session_id_idx" ON "copilot_review_items" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "copilot_review_items_turn_id_idx" ON "copilot_review_items" USING btree ("turn_id");--> statement-breakpoint
CREATE INDEX "copilot_review_items_kind_idx" ON "copilot_review_items" USING btree ("kind");--> statement-breakpoint
CREATE UNIQUE INDEX "copilot_review_items_session_sequence_unique" ON "copilot_review_items" USING btree ("session_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "copilot_review_items_session_item_unique" ON "copilot_review_items" USING btree ("session_id","item_id");--> statement-breakpoint
CREATE INDEX "copilot_review_sessions_user_id_idx" ON "copilot_review_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "copilot_review_sessions_user_entity_idx" ON "copilot_review_sessions" USING btree ("user_id","entity_kind","entity_id");--> statement-breakpoint
CREATE INDEX "copilot_review_sessions_workspace_entity_idx" ON "copilot_review_sessions" USING btree ("workspace_id","entity_kind","entity_id");--> statement-breakpoint
CREATE INDEX "copilot_review_sessions_workspace_draft_idx" ON "copilot_review_sessions" USING btree ("workspace_id","entity_kind","draft_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "copilot_review_sessions_scope_key_unique" ON "copilot_review_sessions" USING btree ("session_scope_key") WHERE "copilot_review_sessions"."session_scope_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "copilot_review_sessions_created_at_idx" ON "copilot_review_sessions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "copilot_review_sessions_updated_at_idx" ON "copilot_review_sessions" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "copilot_review_turns_session_id_idx" ON "copilot_review_turns" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "copilot_review_turns_session_status_idx" ON "copilot_review_turns" USING btree ("session_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "copilot_review_turns_session_sequence_unique" ON "copilot_review_turns" USING btree ("session_id","sequence");--> statement-breakpoint
ALTER TABLE "copilot_feedback" ADD CONSTRAINT "copilot_feedback_chat_id_copilot_review_sessions_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."copilot_review_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_checkpoints" ADD CONSTRAINT "workflow_checkpoints_chat_id_copilot_review_sessions_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."copilot_review_sessions"("id") ON DELETE cascade ON UPDATE no action;
