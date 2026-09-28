CREATE TYPE "public"."clip_origin" AS ENUM('live', 'manual');--> statement-breakpoint
CREATE TYPE "public"."clip_status" AS ENUM('pending', 'cutting', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "clips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"origin" "clip_origin" NOT NULL,
	"mark_ms" integer,
	"start_ms" integer,
	"end_ms" integer,
	"title" text DEFAULT '' NOT NULL,
	"status" "clip_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"audio_url" text,
	"share_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clips_share_token_unique" UNIQUE("share_token")
);
--> statement-breakpoint
ALTER TABLE "clips" ADD CONSTRAINT "clips_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clips_meeting_start_idx" ON "clips" USING btree ("meeting_id","start_ms");