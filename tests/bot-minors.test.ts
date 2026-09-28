import { describe, expect, it } from 'vitest';
import { BOT_TEXT, botOutcome, nextBotStatus, type RecallStatusChange, STOPPING_AT_CAP, STOPPING_REQUESTED } from '../lib/bot/outcome';
import { statusLabel } from '../lib/status-label';

const at = (code: string, sec: number, sub_code: string | null = null): RecallStatusChange => ({
  code,
  sub_code,
  created_at: new Date(Date.UTC(2026, 8, 28, 12, 0, sec)).toISOString(),
});

describe('nextBotStatus', () => {
  it('asks the bot to leave once when it goes over the cap', () => {
    expect(nextBotStatus({ current: BOT_TEXT.recording, outcomeText: BOT_TEXT.recording, overCap: true })).toEqual({
      text: STOPPING_AT_CAP,
      leave: true,
    });
    expect(nextBotStatus({ current: STOPPING_AT_CAP, outcomeText: BOT_TEXT.recording, overCap: true })).toEqual({
      text: STOPPING_AT_CAP,
      leave: false,
    });
  });
  it('does not re-send leave once the call has ended (M9)', () => {
    expect(nextBotStatus({ current: BOT_TEXT.processing, outcomeText: BOT_TEXT.processing, overCap: true })).toEqual({
      text: BOT_TEXT.processing,
      leave: false,
    });
  });
  it('keeps a Stopping label until the call ends', () => {
    expect(nextBotStatus({ current: STOPPING_REQUESTED, outcomeText: BOT_TEXT.recording, overCap: false })).toEqual({
      text: STOPPING_REQUESTED,
      leave: false,
    });
    expect(nextBotStatus({ current: STOPPING_REQUESTED, outcomeText: BOT_TEXT.processing, overCap: false })).toEqual({
      text: BOT_TEXT.processing,
      leave: false,
    });
  });
});

describe('stopping before recording (M12)', () => {
  it('says the bot was stopped, not that the meeting ended', () => {
    const changes = [at('in_waiting_room', 1), at('call_ended', 2, 'bot_received_leave_call'), at('done', 3)];
    expect(botOutcome(changes, false)).toEqual({ kind: 'failed', message: 'The bot was stopped before it started recording.' });
  });
});

describe('statusLabel (M14)', () => {
  it('turns status values into readable labels', () => {
    expect(statusLabel('in_meeting')).toBe('in meeting');
    expect(statusLabel('ready')).toBe('ready');
  });
});

describe('isTransientRecallError (M6)', () => {
  it('retries Recall outages, rate limits and network errors', async () => {
    const { isTransientRecallError, RecallError } = await import('../lib/bot/recall');
    expect(isTransientRecallError(new RecallError('x', 503))).toBe(true);
    expect(isTransientRecallError(new RecallError('x', 429))).toBe(true);
    expect(isTransientRecallError(new TypeError('fetch failed'))).toBe(true);
  });
  it('does not retry permanent errors', async () => {
    const { isTransientRecallError, RecallError } = await import('../lib/bot/recall');
    expect(isTransientRecallError(new RecallError('x', 404))).toBe(false);
    expect(isTransientRecallError(new Error('the bot has no recording'))).toBe(false);
  });
});
