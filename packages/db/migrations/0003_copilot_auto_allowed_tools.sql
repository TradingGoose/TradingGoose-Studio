ALTER TABLE "settings" ADD COLUMN "copilot_auto_allowed_tools" jsonb DEFAULT '[]'::jsonb NOT NULL;
