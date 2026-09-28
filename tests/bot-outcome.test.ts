import { describe, expect, it } from 'vitest';
import { BOT_TEXT, botOutcome, botOverCap, type RecallStatusChange, recordingStartedAt } from '../lib/bot/outcome';

let t = 0;
const ch = (code: string, sub_code: string | null = null): RecallStatusChange => ({
  code,
  sub_code,
  created_at: new Date(Date.UTC(2026, 8, 28, 12, 0, t++)).toISOString(),
});

describe('botOutcome', () => {
  it('reports progress while the bot is active', () => {
    expect(botOutcome([], false)).toEqual({ kind: 'active', text: BOT_TEXT.joining });
    expect(botOutcome([ch('joining_call'), ch('in_waiting_room')], false)).toEqual({ kind: 'active', text: BOT_TEXT.waiting });
    expect(botOutcome([ch('joining_call'), ch('in_call_recording')], false)).toEqual({ kind: 'active', text: BOT_TEXT.recording });
    expect(botOutcome([ch('in_call_recording'), ch('call_ended', 'bot_received_leave_call')], true)).toEqual({
      kind: 'active',
      text: BOT_TEXT.processing,
    });
  });
  it('uses the latest change by time, not array order', () => {
    const later = ch('in_call_recording');
    const earlier = { ...ch('in_waiting_room'), created_at: '2026-09-28T11:00:00.000Z' };
    expect(botOutcome([later, earlier], false)).toEqual({ kind: 'active', text: BOT_TEXT.recording });
  });
  it('is recorded when done after recording with a recording available', () => {
    expect(botOutcome([ch('in_call_recording'), ch('call_ended', 'bot_kicked_from_call'), ch('done')], true)).toEqual({ kind: 'recorded' });
  });
  it('fails with a readable message when nothing was recorded', () => {
    const notAdmitted = [ch('in_waiting_room'), ch('call_ended', 'timeout_exceeded_waiting_room'), ch('done')];
    expect(botOutcome(notAdmitted, false)).toEqual({ kind: 'failed', message: "The bot wasn't let into the meeting." });
    const kicked = [ch('in_waiting_room'), ch('call_ended', 'bot_kicked_from_waiting_room'), ch('done')];
    expect(botOutcome(kicked, false)).toEqual({ kind: 'failed', message: 'The bot was removed or not allowed to record.' });
    const ended = [ch('joining_call'), ch('call_ended', 'meeting_ended'), ch('done')];
    expect(botOutcome(ended, false)).toEqual({ kind: 'failed', message: 'The meeting ended before the bot could record.' });
    expect(botOutcome([ch('in_call_not_recording'), ch('recording_permission_denied')], false)).toEqual({
      kind: 'failed',
      message: 'The bot was removed or not allowed to record.',
    });
    expect(botOutcome([ch('joining_call'), ch('fatal', 'meeting_not_found')], false)).toEqual({
      kind: 'failed',
      message: 'The bot hit an error: meeting_not_found.',
    });
  });
});

describe('recordingStartedAt / botOverCap', () => {
  it('finds the first in_call_recording time', () => {
    const rec = ch('in_call_recording');
    expect(recordingStartedAt([ch('joining_call'), rec, ch('in_call_recording')])?.toISOString()).toBe(rec.created_at);
    expect(recordingStartedAt([ch('joining_call')])).toBeNull();
  });
  it('is over the cap only after 2 hours of recording', () => {
    const start = new Date('2026-09-28T10:00:00Z');
    expect(botOverCap(start, new Date('2026-09-28T12:00:00Z'))).toBe(false);
    expect(botOverCap(start, new Date('2026-09-28T12:00:01Z'))).toBe(true);
    expect(botOverCap(null, new Date())).toBe(false);
  });
});
