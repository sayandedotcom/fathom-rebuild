import { describe, expect, it } from 'vitest';
import { parseNewMeetingTab } from '../lib/new-meeting-tabs';

describe('parseNewMeetingTab', () => {
  it('accepts known tabs', () => {
    expect(parseNewMeetingTab('record')).toBe('record');
    expect(parseNewMeetingTab('bot')).toBe('bot');
  });

  it('falls back to upload for missing, unknown or repeated params', () => {
    expect(parseNewMeetingTab(undefined)).toBe('upload');
    expect(parseNewMeetingTab('nope')).toBe('upload');
    expect(parseNewMeetingTab(['record', 'bot'])).toBe('upload');
  });
});
