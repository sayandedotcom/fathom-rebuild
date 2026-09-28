import { and, eq, isNull, notInArray, or } from 'drizzle-orm';
import { db } from '../db';
import { type Meeting, meetings } from '../db/schema';
import { copyBotAudioAndSubmit } from './finish';
import {
  BOT_TEXT,
  botMeetingExpired,
  botOutcome,
  botOverCap,
  isStoppingText,
  nextBotStatus,
  recordingStartedAt,
  STOPPING_AT_CAP,
  STOPPING_REQUESTED,
} from './outcome';
import { getBot, leaveCall, type RecallBot } from './recall';

export async function advanceBotMeeting(meeting: Meeting): Promise<void> {
  if (!meeting.recallBotId) return;
  const inMeeting = and(eq(meetings.id, meeting.id), eq(meetings.status, 'in_meeting'));
  // Safety net: a missed webhook plus a permanently failing Recall read must not leave the meeting stuck forever.
  if (botMeetingExpired(meeting.createdAt, new Date())) {
    await db
      .update(meetings)
      .set({ status: 'failed', error: 'The bot stopped responding, so the meeting could not be recorded.', botStatus: null })
      .where(inMeeting);
    return;
  }
  let bot: RecallBot;
  try {
    bot = await getBot(meeting.recallBotId);
  } catch (err) {
    // A Recall outage must not fail the meeting; the next poll or webhook tries again.
    console.error('Recall getBot failed', meeting.id, err);
    return;
  }
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

  const overCap = botOverCap(recordingStartedAt(bot.status_changes), new Date());
  const next = nextBotStatus({ current: meeting.botStatus, outcomeText: outcome.text, overCap });
  let text = next.text;
  if (next.leave) {
    try {
      await leaveCall(meeting.recallBotId);
    } catch (err) {
      console.error('Recall leaveCall at cap failed', meeting.id, err);
      text = outcome.text;
    }
  }
  if (text === meeting.botStatus) return;
  // A Stop pressed while this poll ran must not be overwritten by a stale "Recording" label.
  const guard =
    isStoppingText(text) || text === BOT_TEXT.processing
      ? inMeeting
      : and(inMeeting, or(isNull(meetings.botStatus), notInArray(meetings.botStatus, [STOPPING_AT_CAP, STOPPING_REQUESTED])));
  await db.update(meetings).set({ botStatus: text }).where(guard);
}
