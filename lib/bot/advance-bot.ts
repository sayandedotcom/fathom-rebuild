import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { type Meeting, meetings } from '../db/schema';
import { copyBotAudioAndSubmit } from './finish';
import { BOT_TEXT, botOutcome, botOverCap, recordingStartedAt } from './outcome';
import { getBot, leaveCall, type RecallBot } from './recall';

export const STOPPING_AT_CAP = 'Stopping at the 2-hour limit. The recording will be processed next.';
export const STOPPING_REQUESTED = 'Stopping. The recording will be processed next.';

export async function advanceBotMeeting(meeting: Meeting): Promise<void> {
  if (!meeting.recallBotId) return;
  let bot: RecallBot;
  try {
    bot = await getBot(meeting.recallBotId);
  } catch (err) {
    // A Recall outage must not fail the meeting; the next poll or webhook tries again.
    console.error('Recall getBot failed', meeting.id, err);
    return;
  }
  const inMeeting = and(eq(meetings.id, meeting.id), eq(meetings.status, 'in_meeting'));
  const outcome = botOutcome(bot.status_changes, bot.recordings.length > 0);

  if (outcome.kind === 'failed') {
    await db.update(meetings).set({ status: 'failed', error: outcome.message, botStatus: null }).where(inMeeting);
    return;
  }
  if (outcome.kind === 'recorded') {
    // Webhook and poll can both get here; only the caller whose UPDATE matches copies the audio.
    const claimed = await db
      .update(meetings)
      .set({ status: 'transcribing', botStatus: null })
      .where(inMeeting)
      .returning({ id: meetings.id });
    if (claimed.length > 0) await copyBotAudioAndSubmit(meeting.id);
    return;
  }

  const stopping = meeting.botStatus === STOPPING_AT_CAP || meeting.botStatus === STOPPING_REQUESTED;
  let text: string = stopping && outcome.text !== BOT_TEXT.processing ? meeting.botStatus! : outcome.text;
  if (botOverCap(recordingStartedAt(bot.status_changes), new Date()) && meeting.botStatus !== STOPPING_AT_CAP) {
    try {
      await leaveCall(meeting.recallBotId);
      text = STOPPING_AT_CAP;
    } catch (err) {
      console.error('Recall leaveCall at cap failed', meeting.id, err);
    }
  }
  if (text !== meeting.botStatus) await db.update(meetings).set({ botStatus: text }).where(inMeeting);
}
