import { put } from '@vercel/blob';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db';
import { meetings } from '../db/schema';
import { submitTranscription } from '../pipeline/assemblyai';
import { getBot, getMixedAudioUrl } from './recall';

// Recall's download links expire after 7 days, so the audio is copied into our Blob store before transcription.
export async function copyBotAudioAndSubmit(id: string): Promise<void> {
  const meeting = await db.query.meetings.findFirst({ where: eq(meetings.id, id) });
  if (!meeting?.recallBotId || meeting.status !== 'transcribing' || meeting.assemblyaiId) return;
  const copying = and(eq(meetings.id, id), eq(meetings.status, 'transcribing'), isNull(meetings.assemblyaiId));
  try {
    const bot = await getBot(meeting.recallBotId);
    const recordingId = bot.recordings[0]?.id;
    if (!recordingId) throw new Error('the bot has no recording');
    const sourceUrl = await getMixedAudioUrl(recordingId);
    if (!sourceUrl) throw new Error('the recording audio is not ready');
    const res = await fetch(sourceUrl);
    if (!res.ok || !res.body) throw new Error(`downloading the recording failed (${res.status})`);
    const blob = await put(`meetings/bot-${id}.mp3`, res.body, {
      access: 'public',
      contentType: 'audio/mpeg',
      addRandomSuffix: true,
      multipart: true,
    });
    const assemblyaiId = await submitTranscription(blob.url);
    await db.update(meetings).set({ audioUrl: blob.url, assemblyaiId }).where(copying);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(meetings)
      .set({ status: 'failed', error: `Could not process the bot recording: ${message}` })
      .where(copying);
  }
}
