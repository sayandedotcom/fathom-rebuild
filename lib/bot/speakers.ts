import { eq } from 'drizzle-orm';
import { db } from '../db';
import { meetings } from '../db/schema';
import { matchSpeakers } from '../transcript/speakers';
import { getSpeakerTimeline } from './recall';

// Best effort: a missing or odd timeline keeps the "Speaker A" labels and never fails the meeting.
export async function nameBotSpeakers(
  meetingId: string,
  botId: string,
  rows: { speaker: string; startMs: number; endMs: number }[],
): Promise<void> {
  try {
    const timeline = await getSpeakerTimeline(botId);
    if (!timeline || timeline.length === 0) return;
    const names = matchSpeakers(rows, timeline);
    if (Object.keys(names).length > 0) await db.update(meetings).set({ speakerNames: names }).where(eq(meetings.id, meetingId));
  } catch (err) {
    console.error('Naming bot speakers failed', meetingId, err);
  }
}
