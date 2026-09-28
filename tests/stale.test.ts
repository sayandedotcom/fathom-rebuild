import { describe, expect, it } from 'vitest';
import { isStaleCopy, isStaleSummarizing, SUMMARIZING_TIMEOUT_MS } from '../lib/pipeline/stale';

const now = new Date('2026-09-28T12:00:00Z');

describe('isStaleSummarizing', () => {
  it('is stale when summarizing longer than the timeout', () => {
    expect(isStaleSummarizing('summarizing', new Date(now.getTime() - SUMMARIZING_TIMEOUT_MS - 1), now)).toBe(true);
  });
  it('is not stale within the timeout', () => {
    expect(isStaleSummarizing('summarizing', new Date(now.getTime() - 1000), now)).toBe(false);
  });
  it('only applies to summarizing', () => {
    expect(isStaleSummarizing('transcribing', new Date(0), now)).toBe(false);
    expect(isStaleSummarizing('ready', new Date(0), now)).toBe(false);
  });
});

describe('isStaleCopy', () => {
  it('is stale after the timeout', () => {
    expect(isStaleCopy(new Date(now.getTime() - SUMMARIZING_TIMEOUT_MS - 1), now)).toBe(true);
    expect(isStaleCopy(new Date(now.getTime() - 1000), now)).toBe(false);
  });
});
