import { del, put } from '@vercel/blob';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { db } from '../db';
import { clips, meetings } from '../db/schema';
import { cutAudio } from './ffmpeg';

export async function cutClip(id: string): Promise<void> {
  // Only one caller wins the claim, so a retry click racing an automatic cut never cuts twice.
  const [claimed] = await db
    .update(clips)
    .set({ status: 'cutting', error: null })
    .where(and(eq(clips.id, id), inArray(clips.status, ['pending', 'failed']), isNotNull(clips.startMs), isNotNull(clips.endMs)))
    .returning({ meetingId: clips.meetingId, startMs: clips.startMs, endMs: clips.endMs, shareToken: clips.shareToken });
  if (!claimed) return;
  const cutting = and(eq(clips.id, id), eq(clips.status, 'cutting'));
  try {
    const [meeting] = await db.select({ audioUrl: meetings.audioUrl }).from(meetings).where(eq(meetings.id, claimed.meetingId));
    if (!meeting?.audioUrl) throw new Error('the meeting has no recording');
    const audio = await cutAudio(meeting.audioUrl, claimed.startMs!, claimed.endMs!);
    // Named by the share token, not the clip id: the share page renders this URL, and the id would let a
    // recipient call the unauthenticated DELETE /api/clips/<id>.
    const blob = await put(`clips/${claimed.shareToken}.mp3`, audio, { access: 'public', contentType: 'audio/mpeg', addRandomSuffix: true });
    const saved = await db.update(clips).set({ status: 'ready', audioUrl: blob.url }).where(cutting).returning({ id: clips.id });
    // The clip (or its meeting) was deleted while cutting: don't leave an orphaned file behind.
    if (saved.length === 0) await del(blob.url).catch((err) => console.error('Blob delete of orphan clip failed', id, err));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(clips).set({ status: 'failed', error: `Could not cut the clip: ${message}` }).where(cutting);
  }
}

// Every clip that has a range but no audio yet; failed ones are retried too.
export async function cutMeetingClips(meetingId: string): Promise<void> {
  const rows = await db
    .select({ id: clips.id })
    .from(clips)
    .where(and(eq(clips.meetingId, meetingId), inArray(clips.status, ['pending', 'failed']), isNotNull(clips.startMs)));
  for (const r of rows) await cutClip(r.id);
}
