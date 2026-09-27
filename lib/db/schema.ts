import { sql } from 'drizzle-orm';
import { customType, index, integer, jsonb, pgEnum, pgTable, serial, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { Summary } from '../summary-schema';

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

export const meetingStatus = pgEnum('meeting_status', ['transcribing', 'summarizing', 'ready', 'failed']);

export const meetings = pgTable('meetings', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  audioUrl: text('audio_url').notNull(),
  durationSec: integer('duration_sec'),
  status: meetingStatus('status').notNull().default('transcribing'),
  error: text('error'),
  assemblyaiId: text('assemblyai_id').notNull().unique(),
  summary: jsonb('summary').$type<Summary>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const utterances = pgTable(
  'utterances',
  {
    id: serial('id').primaryKey(),
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    speaker: text('speaker').notNull(),
    startMs: integer('start_ms').notNull(),
    endMs: integer('end_ms').notNull(),
    text: text('text').notNull(),
    tsv: tsvector('tsv').generatedAlwaysAs(sql`to_tsvector('english', text)`),
  },
  (t) => [
    index('utterances_tsv_idx').using('gin', t.tsv),
    index('utterances_meeting_start_idx').on(t.meetingId, t.startMs),
  ],
);

export type Meeting = typeof meetings.$inferSelect;
export type MeetingStatus = Meeting['status'];
export type Utterance = typeof utterances.$inferSelect;
export type NewUtterance = typeof utterances.$inferInsert;
