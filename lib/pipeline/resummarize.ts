import { and, eq } from 'drizzle-orm';
import { after } from 'next/server';
import { db } from '../db';
import { meetings } from '../db/schema';
import { summarizeMeeting } from './advance';

// Renames and template changes regenerate the summary. Only a `ready` meeting is claimed, so a
// summary that is already running is never doubled; it picks up the saved change when it reads the meeting.
export async function startResummarize(id: string): Promise<boolean> {
  const claimed = await db
    .update(meetings)
    .set({ status: 'summarizing', error: null })
    .where(and(eq(meetings.id, id), eq(meetings.status, 'ready')))
    .returning({ id: meetings.id });
  if (claimed.length === 0) return false;
  after(() => summarizeMeeting(id));
  return true;
}
