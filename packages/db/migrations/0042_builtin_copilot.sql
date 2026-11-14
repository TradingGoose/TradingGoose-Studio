ALTER TABLE "copilot_review_items" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "copilot_review_sessions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "copilot_review_turns" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "memory" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "copilot_review_items" CASCADE;--> statement-breakpoint
DROP TABLE "copilot_review_sessions" CASCADE;--> statement-breakpoint
DROP TABLE "copilot_review_turns" CASCADE;--> statement-breakpoint
DROP TABLE "memory" CASCADE;--> statement-breakpoint
ALTER TABLE "docs_embeddings" ALTER COLUMN "embedding_model" SET DEFAULT 'openai/text-embedding-3-small';--> statement-breakpoint
ALTER TABLE "embedding" ALTER COLUMN "embedding_model" SET DEFAULT 'openai/text-embedding-3-small';--> statement-breakpoint
ALTER TABLE "knowledge_base" ALTER COLUMN "embedding_model" SET DEFAULT 'openai/text-embedding-3-small';