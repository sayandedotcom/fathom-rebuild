CREATE TYPE "public"."meeting_template" AS ENUM('general', 'sales', 'one_on_one', 'standup', 'interview');--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "template" "meeting_template" DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "speaker_names" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "title_is_auto" boolean DEFAULT false NOT NULL;