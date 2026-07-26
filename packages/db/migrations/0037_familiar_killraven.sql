DROP TABLE "marketplace" CASCADE;--> statement-breakpoint
DROP TABLE "template_stars" CASCADE;--> statement-breakpoint
DROP TABLE "templates" CASCADE;--> statement-breakpoint
ALTER TABLE "workflow" DROP COLUMN "is_published";--> statement-breakpoint
ALTER TABLE "workflow" DROP COLUMN "marketplace_data";--> statement-breakpoint
ALTER TABLE "custom_indicators" DROP COLUMN "input_meta";