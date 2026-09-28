import { put } from '@vercel/blob';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db';
import { meetings } from '../db/schema';
import { submitTranscription } from '../pipeline/assemblyai';
import { BOT_TEXT } from './outcome';
import { getBot, getMixedAudioUrl, isTransientRecallError } from './recall';

// Recall's download links expire after 7 days, so the audio is copied into our Blob store before transcription.
export async function copyBotAudioAndSubmit(id: string): Promise<void> {
  const meeting = await db.query.meetings.findFirst({ where: eq(meetings.id, id) });
  if (!meeting?.recallBotId || meeting.status !== 'transcribing' || meeting.assemblyaiId) return;
  const copying = and(eq(meetings.id, id), eq(meetings.status, 'transcribing'), isNull(meetings.assemblyaiId));
  const fail = (err: unknown) =>
    db
      .update(meetings)
      .set({ status: 'failed', error: `Could not process the bot recording: ${err instanceof Error ? err.message : String(err)}` })
      .where(copying);
  // Nothing has been copied yet, so a temporary Recall problem hands the meeting back to the poll/webhook to try again.
  const waitForRecall = () =>
    db.update(meetings).set({ status: 'in_meeting', botStatus: BOT_TEXT.processing }).where(copying);

  let sourceUrl: string | null;
  try {
    const bot = await getBot(meeting.recallBotId);
    const recordingId = bot.recordings[0]?.id;
    if (!recordingId) throw new Error('the bot has no recording');
    sourceUrl = await getMixedAudioUrl(recordingId);
  } catch (err) {
    await (isTransientRecallError(err) ? waitForRecall() : fail(err));
    return;
  }
  if (!sourceUrl) {
    await waitForRecall();
    return;
  }

  try {
    const res = await fetch(sourceUrl);
    if (!res.ok || !res.body) throw new Error(`downloading the recording failed (${res.status})`);
    const blob = await put(`meetings/bot-${id}.mp3`, res.body, {
      access: 'public',
      contentType: 'audio/mpeg',
      addRandomSuffix: true,
      multipart: true,
    });
    // Save the copy first: if AssemblyAI rejects it, Retry resubmits this audio instead of copying it again.
    await db.update(meetings).set({ audioUrl: blob.url }).where(copying);
    const assemblyaiId = await submitTranscription(blob.url);
    await db.update(meetings).set({ assemblyaiId }).where(copying);
  } catch (err) {
    await fail(err);
  }
}
