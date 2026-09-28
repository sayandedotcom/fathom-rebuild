import { describe, expect, it } from 'vitest';
import { isMeetUrl } from '../lib/bot/meet-url';

describe('isMeetUrl', () => {
  it('accepts Google Meet meeting links', () => {
    expect(isMeetUrl('https://meet.google.com/abc-defg-hij')).toBe(true);
    expect(isMeetUrl('https://meet.google.com/abc-defg-hij?authuser=1')).toBe(true);
    expect(isMeetUrl('  https://meet.google.com/abc-defg-hij  ')).toBe(true);
  });
  it('rejects everything else', () => {
    expect(isMeetUrl('http://meet.google.com/abc-defg-hij')).toBe(false);
    expect(isMeetUrl('https://meet.google.com/lookup/abcdef')).toBe(false);
    expect(isMeetUrl('https://meet.google.com.evil.com/abc-defg-hij')).toBe(false);
    expect(isMeetUrl('https://us02web.zoom.us/j/123456789')).toBe(false);
    expect(isMeetUrl('abc-defg-hij')).toBe(false);
    expect(isMeetUrl('')).toBe(false);
  });
});
