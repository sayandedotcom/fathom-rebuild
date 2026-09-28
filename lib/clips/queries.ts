import { and, asc, count, eq, inArray, isNotNull, lt, or } from 'drizzle-orm';
import { db } from '../db';
import { clips } from '../db/schema';
import { CLIP_CUT_TIMEOUT_MS, CLIP_PENDING_TIMEOUT_MS, type ClipItem } from './logic';

// A function that died mid-cut (or before it started) would leave the clip busy forever; this frees it for Retry.
// `cutting` clips get the short timeout; ranged-but-still-`pending` ones get a longer one, since they can be
// waiting behind the summary and earlier cuts in the same after() rather than stuck.
export async function failStaleClips(meetingId: string): Promise<void> {
  const cuttingCutoff = new Date(Date.now() - CLIP_CUT_TIMEOUT_MS);
  const pendingCutoff = new Date(Date.now() - CLIP_PENDING_TIMEOUT_MS);
  await db
    .update(clips)
    .set({ status: 'failed', error: 'Cutting the clip timed out.' })
    .where(
      and(
        eq(clips.meetingId, meetingId),
        or(
          and(eq(clips.status, 'cutting'), lt(clips.updatedAt, cuttingCutoff)),
          and(eq(clips.status, 'pending'), isNotNull(clips.startMs), lt(clips.updatedAt, pendingCutoff)),
        ),
      ),
    );
}

export async function listClips(meetingId: string): Promise<ClipItem[]> {
  await failStaleClips(meetingId);
  return db
    .select({
      id: clips.id,
      origin: clips.origin,
      markMs: clips.markMs,
      startMs: clips.startMs,
      endMs: clips.endMs,
      title: clips.title,
      status: clips.status,
      error: clips.error,
      shareToken: clips.shareToken,
    })
    .from(clips)
    .where(eq(clips.meetingId, meetingId))
    .orderBy(asc(clips.createdAt));
}

// Clips the page is waiting on; unplaced live highlights are covered by the meeting's own polling.
export async function countBusyClips(meetingId: string): Promise<number> {
  const [{ n }] = await db
    .select({ n: count() })
    .from(clips)
    .where(and(eq(clips.meetingId, meetingId), inArray(clips.status, ['pending', 'cutting']), isNotNull(clips.startMs)));
  return n;
}
