CREATE TYPE "public"."meeting_source" AS ENUM('upload', 'record', 'bot');--> statement-breakpoint
ALTER TYPE "public"."meeting_status" ADD VALUE 'in_meeting' BEFORE 'transcribing';--> statement-breakpoint
ALTER TABLE "meetings" ALTER COLUMN "audio_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "meetings" ALTER COLUMN "assemblyai_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "source" "meeting_source" DEFAULT 'upload' NOT NULL;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "recall_bot_id" text;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "bot_status" text;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_recall_bot_id_unique" UNIQUE("recall_bot_id");