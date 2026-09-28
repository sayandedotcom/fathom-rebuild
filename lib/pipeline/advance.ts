import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { advanceBotMeeting } from '../bot/advance-bot';
import { nameBotSpeakers } from '../bot/speakers';
import { db } from '../db';
import { meetings, utterances } from '../db/schema';
import { exceedsMaxDuration } from '../limits';
import { EMPTY_SUMMARY } from '../summary-schema';
import { pickAutoTitle } from '../titles';
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
  if (meeting.source === 'bot' && meeting.recallBotId) await nameBotSpeakers(id, meeting.recallBotId, rows);
  await summarizeMeeting(id);
}

// A rename or template change can land while Claude is still writing (20-60s). The summary is only
// saved if the names and template are unchanged since it started; otherwise it is written again.
const MAX_SUMMARY_PASSES = 3;

export async function summarizeMeeting(id: string): Promise<void> {
  for (let pass = 1; pass <= MAX_SUMMARY_PASSES; pass++) {
    const meeting = await db.query.meetings.findFirst({
      where: eq(meetings.id, id),
      columns: { speakerNames: true, template: true, titleIsAuto: true },
    });
    if (!meeting) return;
    const lines = await db
      .select({ speaker: utterances.speaker, startMs: utterances.startMs, text: utterances.text })
      .from(utterances)
      .where(eq(utterances.meetingId, id))
      .orderBy(asc(utterances.startMs));
    try {
      const summary = lines.length === 0 ? EMPTY_SUMMARY : await summarize(formatTranscript(lines, meeting.speakerNames), meeting.template);
      const unchanged =
        pass === MAX_SUMMARY_PASSES
          ? eq(meetings.id, id)
          : and(
              eq(meetings.id, id),
              sql`${meetings.speakerNames} = ${JSON.stringify(meeting.speakerNames)}::jsonb`,
              eq(meetings.template, meeting.template),
            );
      const saved = await db
        .update(meetings)
        .set({ status: 'ready', summary, error: null })
        .where(unchanged)
        .returning({ id: meetings.id });
      if (saved.length === 0) continue;
      const autoTitle = pickAutoTitle(meeting.titleIsAuto, summary.title);
      if (autoTitle) {
        await db.update(meetings).set({ title: autoTitle }).where(and(eq(meetings.id, id), eq(meetings.titleIsAuto, true)));
      }
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db.update(meetings).set({ status: 'failed', error: `Summary failed: ${message}` }).where(eq(meetings.id, id));
      return;
    }
  }
}
