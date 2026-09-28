import { MAX_DURATION_SEC } from '../limits';

export type RecallStatusChange = { code: string; sub_code: string | null; created_at: string };

export type BotOutcome = { kind: 'active'; text: string } | { kind: 'recorded' } | { kind: 'failed'; message: string };

export const BOT_TEXT = {
  joining: 'Joining the meeting…',
  waiting: 'Waiting to be let in: admit “Fanthom Notetaker” in Google Meet.',
  inCall: 'In the call, starting to record…',
  recording: 'Recording',
  processing: 'Call ended, processing the recording…',
} as const;

const REMOVED = 'The bot was removed or not allowed to record.';

// Stop recording 2 minutes before the 2h processing limit, so leave latency can't push the audio over it.
export const BOT_RECORDING_CAP_SEC = MAX_DURATION_SEC - 120;
// No bot can still be joining or recording this long after creation (waiting room + cap + margin).
export const BOT_MEETING_MAX_AGE_MS = (MAX_DURATION_SEC + 3600) * 1000;

function latestChange(changes: RecallStatusChange[]): RecallStatusChange | null {
  let latest: RecallStatusChange | null = null;
  for (const c of changes) {
    if (!latest || Date.parse(c.created_at) >= Date.parse(latest.created_at)) latest = c;
  }
  return latest;
}

function endedMessage(subCode: string | null): string {
  if (subCode?.startsWith('bot_kicked')) return REMOVED;
  if (subCode?.startsWith('timeout_exceeded_waiting_room')) return "The bot wasn't let into the meeting.";
  return 'The meeting ended before the bot could record.';
}

export function botOutcome(changes: RecallStatusChange[], hasRecording: boolean): BotOutcome {
  // Terminal codes win even if Recall appends later ones (e.g. media_expired after done).
  const fatal = changes.find((c) => c.code === 'fatal');
  if (fatal) return { kind: 'failed', message: `The bot hit an error: ${fatal.sub_code ?? 'unknown'}.` };
  if (changes.some((c) => c.code === 'done')) {
    const recorded = changes.some((c) => c.code === 'in_call_recording');
    if (recorded && hasRecording) return { kind: 'recorded' };
    return { kind: 'failed', message: endedMessage(changes.find((c) => c.code === 'call_ended')?.sub_code ?? null) };
  }
  const latest = latestChange(changes);
  switch (latest?.code) {
    case 'in_waiting_room':
      return { kind: 'active', text: BOT_TEXT.waiting };
    case 'in_call_not_recording':
    case 'recording_permission_allowed':
      return { kind: 'active', text: BOT_TEXT.inCall };
    case 'in_call_recording':
      return { kind: 'active', text: BOT_TEXT.recording };
    case 'call_ended':
    case 'recording_done':
      return { kind: 'active', text: BOT_TEXT.processing };
    case 'recording_permission_denied':
      return { kind: 'failed', message: REMOVED };
    default:
      return { kind: 'active', text: BOT_TEXT.joining };
  }
}

export function recordingStartedAt(changes: RecallStatusChange[]): Date | null {
  const times = changes.filter((c) => c.code === 'in_call_recording').map((c) => Date.parse(c.created_at));
  return times.length === 0 ? null : new Date(Math.min(...times));
}

export function botOverCap(startedAt: Date | null, now: Date): boolean {
  return startedAt !== null && now.getTime() - startedAt.getTime() > BOT_RECORDING_CAP_SEC * 1000;
}

export function botMeetingExpired(createdAt: Date, now: Date): boolean {
  return now.getTime() - createdAt.getTime() > BOT_MEETING_MAX_AGE_MS;
}

// A bot meeting without audio can only be retried when the recording exists but copying it failed.
export function canRetry(meeting: { source: string; audioUrl: string | null; error: string | null }): boolean {
  if (meeting.source !== 'bot' || meeting.audioUrl !== null) return true;
  return (
    meeting.error?.startsWith('Copying the bot recording') === true ||
    meeting.error?.startsWith('Could not process the bot recording') === true
  );
}
