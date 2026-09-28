import { describe, expect, it } from 'vitest';
import { matchSpeakers, speakerName } from '../lib/transcript/speakers';

const u = (speaker: string, startMs: number, endMs: number) => ({ speaker, startMs, endMs });

describe('speakerName', () => {
  it('uses the saved name, else the letter', () => {
    expect(speakerName('A', { A: 'Priya' })).toBe('Priya');
    expect(speakerName('B', { A: 'Priya' })).toBe('Speaker B');
    expect(speakerName('A', { A: '   ' })).toBe('Speaker A');
  });
});

describe('matchSpeakers', () => {
  it('maps each label to the participant it overlaps most', () => {
    const utts = [u('A', 0, 10_000), u('B', 10_000, 20_000), u('A', 20_000, 25_000)];
    const timeline = [
      { name: 'Priya', startMs: 0, endMs: 10_500 },
      { name: 'Sam', startMs: 10_500, endMs: 19_000 },
      { name: 'Priya', startMs: 19_000, endMs: 26_000 },
    ];
    expect(matchSpeakers(utts, timeline)).toEqual({ A: 'Priya', B: 'Sam' });
  });
  it('leaves a label unnamed when no participant covers half its talk time', () => {
    expect(matchSpeakers([u('A', 0, 10_000)], [{ name: 'Priya', startMs: 6_000, endMs: 10_000 }])).toEqual({});
  });
  it('treats a missing end as running until the next entry starts, or forever', () => {
    const timeline = [
      { name: 'Priya', startMs: 0, endMs: null },
      { name: 'Sam', startMs: 8_000, endMs: null },
    ];
    expect(matchSpeakers([u('A', 0, 8_000), u('B', 8_000, 60_000)], timeline)).toEqual({ A: 'Priya', B: 'Sam' });
  });
  it('breaks ties in favour of the participant listed first', () => {
    const timeline = [
      { name: 'Priya', startMs: 0, endMs: 5_000 },
      { name: 'Sam', startMs: 5_000, endMs: 10_000 },
    ];
    expect(matchSpeakers([u('A', 0, 10_000)], timeline)).toEqual({ A: 'Priya' });
  });
  it('allows two labels to map to the same person', () => {
    const timeline = [{ name: 'Priya', startMs: 0, endMs: 20_000 }];
    expect(matchSpeakers([u('A', 0, 5_000), u('B', 6_000, 12_000)], timeline)).toEqual({ A: 'Priya', B: 'Priya' });
  });
  it('returns nothing for an empty timeline', () => {
    expect(matchSpeakers([u('A', 0, 5_000)], [])).toEqual({});
  });
});
