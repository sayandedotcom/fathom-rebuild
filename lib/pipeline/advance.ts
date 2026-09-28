import { and, asc, eq, isNull } from 'drizzle-orm';
import { advanceBotMeeting } from '../bot/advance-bot';
import { db } from '../db';
import { meetings, utterances } from '../db/schema';
import { exceedsMaxDuration } from '../limits';
import { EMPTY_SUMMARY } from '../summary-schema';
import { formatTranscript } from '../transcript/format';
import { getTranscription } from './assemblyai';
import { mapUtterances } from './map-utterances';
import { isStaleCopy, isStaleSummarizing } from './stale';
import { summarize } from './summarize';

const INSERT_CHUNK = 500;

export async function advanceMeeting(id: string): Promise<void> {
  const meeting = await db.query.meetings.findFirst({ where: eq(meetings.id, id) });
  if (!meeting) return;
  if (meeting.status === 'in_meeting') return advanceBotMeeting(meeting);

  if (isStaleSummarizing(meeting.status, meeting.updatedAt, new Date())) {
    await db
      .update(meetings)
      .set({ status: 'failed', error: 'Summarization timed out.' })
      .where(and(eq(meetings.id, id), eq(meetings.status, 'summarizing')));
    return;
  }
  if (meeting.status !== 'transcribing') return;
  // Bot meetings enter `transcribing` before the audio copy finishes.
  if (!meeting.assemblyaiId) {
    if (isStaleCopy(meeting.updatedAt, new Date())) {
      await db
        .update(meetings)
        .set({ status: 'failed', error: 'Copying the bot recording timed out.' })
        .where(and(eq(meetings.id, id), eq(meetings.status, 'transcribing'), isNull(meetings.assemblyaiId)));
    }
    return;
  }

  const transcript = await getTranscription(meeting.assemblyaiId);
  if (transcript.status === 'queued' || transcript.status === 'processing') return;
  if (transcript.status === 'error') {
    await db
      .update(meetings)
      .set({ status: 'failed', error: `Transcription failed: ${transcript.error ?? 'unknown error'}` })
      .where(and(eq(meetings.id, id), eq(meetings.status, 'transcribing')));
    return;
  }

  // The browser can't always read a file's duration, so the 2h limit is enforced here too, before any LLM cost.
  if (exceedsMaxDuration(transcript.audio_duration)) {
    await db
      .update(meetings)
      .set({ status: 'failed', error: 'Recordings longer than 2 hours are not supported.' })
      .where(and(eq(meetings.id, id), eq(meetings.status, 'transcribing')));
    return;
  }

  // Webhook and poll can both get here; only the caller whose UPDATE matches proceeds.
  const claimed = await db
    .update(meetings)
    .set({
      status: 'summarizing',
      durationSec: transcript.audio_duration ? Math.round(transcript.audio_duration) : meeting.durationSec,
    })
    .where(and(eq(meetings.id, id), eq(meetings.status, 'transcribing')))
    .returning({ id: meetings.id });
  if (claimed.length === 0) return;

  const rows = mapUtterances(id, transcript.utterances);
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    await db.insert(utterances).values(rows.slice(i, i + INSERT_CHUNK));
  }
  await summarizeMeeting(id);
}

export async function summarizeMeeting(id: string): Promise<void> {
  const lines = await db
    .select({ speaker: utterances.speaker, startMs: utterances.startMs, text: utterances.text })
    .from(utterances)
    .where(eq(utterances.meetingId, id))
    .orderBy(asc(utterances.startMs));
  try {
    const summary = lines.length === 0 ? EMPTY_SUMMARY : await summarize(formatTranscript(lines));
    await db.update(meetings).set({ status: 'ready', summary, error: null }).where(eq(meetings.id, id));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(meetings).set({ status: 'failed', error: `Summary failed: ${message}` }).where(eq(meetings.id, id));
  }
}
