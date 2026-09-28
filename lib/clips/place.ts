import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db';
import { clips } from '../db/schema';
import type { Summary } from '../summary-schema';
import { labelsForClips, liveClipRange } from './logic';

// Live highlights get their range once the transcript exists. Clips already placed (e.g. on a re-summary) are returned as they are.
export async function placeLiveClips(
  meetingId: string,
  utterances: { startMs: number; endMs: number }[],
  durationSec: number | null,
): Promise<{ id: string; startMs: number }[]> {
  const live = await db
    .select({ id: clips.id, markMs: clips.markMs, startMs: clips.startMs })
    .from(clips)
    .where(and(eq(clips.meetingId, meetingId), eq(clips.origin, 'live')));
  const durationMs = durationSec === null ? null : durationSec * 1000;
  const placed: { id: string; startMs: number }[] = [];
  for (const c of live) {
    if (c.startMs !== null) {
      placed.push({ id: c.id, startMs: c.startMs });
      continue;
    }
    const range = c.markMs === null ? null : liveClipRange(c.markMs, utterances, durationMs);
    if (!range) {
      await db.update(clips).set({ status: 'failed', error: 'The recording is too short to clip.' }).where(eq(clips.id, c.id));
      continue;
    }
    await db.update(clips).set(range).where(and(eq(clips.id, c.id), isNull(clips.startMs)));
    placed.push({ id: c.id, startMs: range.startMs });
  }
  return placed;
}

// A title the user already has (or an earlier label) is never overwritten.
export async function labelClips(placed: { id: string; startMs: number }[], highlights: Summary['highlights']): Promise<void> {
  for (const [id, label] of labelsForClips(placed, highlights)) {
    await db.update(clips).set({ title: label }).where(and(eq(clips.id, id), eq(clips.title, '')));
  }
}
