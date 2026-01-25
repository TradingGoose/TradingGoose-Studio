ALTER TABLE "custom_indicators" DROP COLUMN "draw_code";--> statement-breakpoint
ALTER TABLE "custom_indicators" DROP COLUMN "tooltip_code";--> statement-breakpoint
ALTER TABLE "custom_indicators" DROP COLUMN "regenerate_figures_code";
ALTER TABLE "custom_indicators" ALTER COLUMN "name" SET DEFAULT 'New Indicator';
ALTER TABLE "custom_indicators" ADD COLUMN "should_ohlc" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "custom_indicators" ADD COLUMN "color" text DEFAULT '#3972F6' NOT NULL;