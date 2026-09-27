CREATE TYPE "public"."meeting_status" AS ENUM('transcribing', 'summarizing', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"audio_url" text NOT NULL,
	"duration_sec" integer,
	"status" "meeting_status" DEFAULT 'transcribing' NOT NULL,
	"error" text,
	"assemblyai_id" text NOT NULL,
	"summary" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meetings_assemblyai_id_unique" UNIQUE("assemblyai_id")
);
--> statement-breakpoint
CREATE TABLE "utterances" (
	"id" serial PRIMARY KEY NOT NULL,
	"meeting_id" uuid NOT NULL,
	"speaker" text NOT NULL,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL,
	"text" text NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', text)) STORED
);
--> statement-breakpoint
ALTER TABLE "utterances" ADD CONSTRAINT "utterances_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "utterances_tsv_idx" ON "utterances" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "utterances_meeting_start_idx" ON "utterances" USING btree ("meeting_id","start_ms");