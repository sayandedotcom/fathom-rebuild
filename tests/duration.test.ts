import { describe, expect, it } from 'vitest';
import { clampDurationSec, exceedsMaxDuration, MAX_DURATION_SEC } from '../lib/limits';

describe('clampDurationSec', () => {
  it('rounds elapsed milliseconds to seconds', () => {
    expect(clampDurationSec(65_400)).toBe(65);
  });
  it('never exceeds the 2h cap, so an auto-stopped recording is accepted by the server', () => {
    expect(clampDurationSec(7_200_600)).toBe(MAX_DURATION_SEC);
    expect(clampDurationSec(7_203_000)).toBe(MAX_DURATION_SEC);
  });
});

describe('exceedsMaxDuration', () => {
  it('flags audio longer than 2h', () => {
    expect(exceedsMaxDuration(MAX_DURATION_SEC + 1)).toBe(true);
  });
  it('accepts 2h or less, and unknown durations', () => {
    expect(exceedsMaxDuration(MAX_DURATION_SEC)).toBe(false);
    expect(exceedsMaxDuration(null)).toBe(false);
    expect(exceedsMaxDuration(undefined)).toBe(false);
  });
});
