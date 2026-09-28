import { describe, expect, it } from 'vitest';
import {
  BOT_MEETING_MAX_AGE_MS,
  BOT_RECORDING_CAP_SEC,
  botMeetingExpired,
  botOutcome,
  botOverCap,
  canRetry,
  type RecallStatusChange,
} from '../lib/bot/outcome';
import { botCreateBody } from '../lib/bot/recall';
import { MAX_DURATION_SEC } from '../lib/limits';

const at = (code: string, sec: number, sub_code: string | null = null): RecallStatusChange => ({
  code,
  sub_code,
  created_at: new Date(Date.UTC(2026, 8, 28, 12, 0, sec)).toISOString(),
});

describe('bot recording cap leaves headroom under the 2h processing limit', () => {
  it('caps recording 2 minutes before MAX_DURATION_SEC', () => {
    expect(BOT_RECORDING_CAP_SEC).toBe(MAX_DURATION_SEC - 120);
    const start = new Date('2026-09-28T10:00:00Z');
    expect(botOverCap(start, new Date(start.getTime() + BOT_RECORDING_CAP_SEC * 1000))).toBe(false);
    expect(botOverCap(start, new Date(start.getTime() + BOT_RECORDING_CAP_SEC * 1000 + 1000))).toBe(true);
  });
  it('asks Recall itself to enforce the cap and the waiting-room timeout', () => {
    const body = botCreateBody('https://meet.google.com/abc-defg-hij', 'm1');
    expect(body.automatic_leave).toMatchObject({ in_call_recording_timeout: BOT_RECORDING_CAP_SEC, waiting_room_timeout: 600 });
    expect(body).toMatchObject({ meeting_url: 'https://meet.google.com/abc-defg-hij', bot_name: 'Fanthom Notetaker', metadata: { meeting_id: 'm1' } });
  });
});

describe('botOutcome never gets stuck after a terminal state', () => {
  it('treats a recording as recorded even if a later code (e.g. media_expired) follows done', () => {
    const changes = [at('in_call_recording', 1), at('call_ended', 2), at('recording_done', 3), at('done', 4), at('media_expired', 5)];
    expect(botOutcome(changes, true)).toEqual({ kind: 'recorded' });
  });
  it('fails on an earlier fatal even if a later code follows', () => {
    expect(botOutcome([at('joining_call', 1), at('fatal', 2, 'meeting_not_found'), at('media_expired', 3)], false)).toEqual({
      kind: 'failed',
      message: 'The bot hit an error: meeting_not_found.',
    });
  });
});

describe('botMeetingExpired', () => {
  it('expires a bot meeting that is still in progress long after any bot could be', () => {
    const created = new Date('2026-09-28T10:00:00Z');
    expect(botMeetingExpired(created, new Date(created.getTime() + BOT_MEETING_MAX_AGE_MS))).toBe(false);
    expect(botMeetingExpired(created, new Date(created.getTime() + BOT_MEETING_MAX_AGE_MS + 1))).toBe(true);
  });
});

describe('canRetry', () => {
  it('allows retry for uploads and for bot meetings whose recording exists or whose copy failed', () => {
    expect(canRetry({ source: 'upload', audioUrl: 'https://x', error: 'Summary failed: x' })).toBe(true);
    expect(canRetry({ source: 'bot', audioUrl: 'https://x', error: 'Transcription failed: x' })).toBe(true);
    expect(canRetry({ source: 'bot', audioUrl: null, error: 'Copying the bot recording timed out.' })).toBe(true);
    expect(canRetry({ source: 'bot', audioUrl: null, error: 'Could not process the bot recording: download failed' })).toBe(true);
  });
  it('does not offer retry when the bot never recorded anything', () => {
    expect(canRetry({ source: 'bot', audioUrl: null, error: "The bot wasn't let into the meeting." })).toBe(false);
    expect(canRetry({ source: 'bot', audioUrl: null, error: 'The bot hit an error: meeting_not_found.' })).toBe(false);
  });
});
