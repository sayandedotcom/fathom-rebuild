import { describe, expect, it } from 'vitest';
import {
  botHighlightOffset,
  clipTitleFromText,
  isShareToken,
  labelsForClips,
  linesInClips,
  liveClipRange,
  rangeFromLines,
  selectionRange,
  visibleClips,
} from '../lib/clips/logic';

const utts = [
  { startMs: 0, endMs: 10_000 },
  { startMs: 10_000, endMs: 40_000 },
  { startMs: 40_000, endMs: 50_000 },
];

describe('liveClipRange', () => {
  it('snaps both edges to the utterances that contain them', () => {
    expect(liveClipRange(45_000, utts, 60_000)).toEqual({ startMs: 10_000, endMs: 50_000 });
  });
  it('clamps at 0 and does not snap an edge more than 15s', () => {
    // raw [0, 15000]; the end sits in 10000–40000, which would widen it by 25s
    expect(liveClipRange(10_000, utts, 60_000)).toEqual({ startMs: 0, endMs: 15_000 });
  });
  it('clamps at the duration', () => {
    expect(liveClipRange(58_000, [], 60_000)).toEqual({ startMs: 28_000, endMs: 60_000 });
  });
  it('clamps a mark past the end of the recording (clicked after Stop)', () => {
    expect(liveClipRange(70_000, [], 60_000)).toEqual({ startMs: 30_000, endMs: 60_000 });
  });
  it('keeps the raw window inside a silence gap', () => {
    expect(liveClipRange(40_000, [{ startMs: 0, endMs: 5_000 }, { startMs: 50_000, endMs: 60_000 }], 100_000)).toEqual({
      startMs: 10_000,
      endMs: 45_000,
    });
  });
  it('does not swallow a long monologue', () => {
    expect(liveClipRange(100_000, [{ startMs: 0, endMs: 120_000 }], 120_000)).toEqual({ startMs: 70_000, endMs: 120_000 });
  });
  it('returns null for an empty recording', () => {
    expect(liveClipRange(0, [], 0)).toBeNull();
  });
  it('works without a known duration', () => {
    expect(liveClipRange(1_000, [], null)).toEqual({ startMs: 0, endMs: 6_000 });
  });
});

describe('selectionRange', () => {
  it('accepts a valid range', () => {
    expect(selectionRange(1_000, 20_000, 60_000)).toEqual({ startMs: 1_000, endMs: 20_000 });
  });
  it('clamps the end to the duration', () => {
    expect(selectionRange(50_000, 60_400, 60_000)).toEqual({ startMs: 50_000, endMs: 60_000 });
  });
  it('rejects empty, reversed and negative ranges', () => {
    expect(selectionRange(5_000, 5_000, 60_000)).toHaveProperty('error');
    expect(selectionRange(6_000, 5_000, 60_000)).toHaveProperty('error');
    expect(selectionRange(-1, 5_000, 60_000)).toHaveProperty('error');
  });
  it('caps clips at 5 minutes', () => {
    expect(selectionRange(0, 300_000, null)).toEqual({ startMs: 0, endMs: 300_000 });
    expect(selectionRange(0, 300_001, null)).toEqual({ error: 'Clips can be at most 5 minutes long.' });
  });
});

describe('rangeFromLines', () => {
  const lines = [
    { id: 1, startMs: 0, endMs: 4_000 },
    { id: 2, startMs: 4_000, endMs: 9_000 },
    { id: 3, startMs: 9_000, endMs: 12_000 },
  ];
  it('spans from the earlier line start to the later line end, in either selection direction', () => {
    expect(rangeFromLines(lines, 1, 2)).toEqual({ startMs: 0, endMs: 9_000 });
    expect(rangeFromLines(lines, 3, 2)).toEqual({ startMs: 4_000, endMs: 12_000 });
  });
  it('returns null for unknown ids', () => {
    expect(rangeFromLines(lines, 1, 99)).toBeNull();
  });
});

describe('botHighlightOffset', () => {
  it('is null before the bot records', () => {
    expect(botHighlightOffset(new Date('2026-09-28T12:00:00Z'), null)).toBeNull();
  });
  it('is the time since recording started, never negative', () => {
    const start = new Date('2026-09-28T12:00:00Z');
    expect(botHighlightOffset(new Date('2026-09-28T12:01:30Z'), start)).toBe(90_000);
    expect(botHighlightOffset(new Date('2026-09-28T11:59:59Z'), start)).toBe(0);
  });
});

describe('clipTitleFromText', () => {
  it('collapses whitespace and keeps short text', () => {
    expect(clipTitleFromText('  We ship\n on Friday ')).toBe('We ship on Friday');
  });
  it('cuts long text to 60 characters with an ellipsis', () => {
    const t = clipTitleFromText('a'.repeat(100));
    expect(t).toHaveLength(60);
    expect(t.endsWith('…')).toBe(true);
  });
});

describe('labelsForClips', () => {
  const clips = [
    { id: 'a', startMs: 62_400 },
    { id: 'b', startMs: 600_000 },
  ];
  it('matches by second regardless of timestamp padding', () => {
    const m = labelsForClips(clips, [
      { timestamp: '1:02', label: 'Pricing pushback' },
      { timestamp: '10:00', label: '  Launch   date agreed ' },
    ]);
    expect(m.get('a')).toBe('Pricing pushback');
    expect(m.get('b')).toBe('Launch date agreed');
  });
  it('ignores unknown timestamps, malformed timestamps and blank labels', () => {
    const m = labelsForClips(clips, [
      { timestamp: '05:00', label: 'Nope' },
      { timestamp: 'soon', label: 'Nope' },
      { timestamp: '01:02', label: '   ' },
    ]);
    expect(m.size).toBe(0);
  });
  it('gives two clips in the same second one label each, in order', () => {
    const m = labelsForClips(
      [
        { id: 'x', startMs: 5_000 },
        { id: 'y', startMs: 5_500 },
      ],
      [
        { timestamp: '00:05', label: 'First' },
        { timestamp: '00:05', label: 'Second' },
      ],
    );
    expect([m.get('x'), m.get('y')]).toEqual(['First', 'Second']);
  });
});

describe('linesInClips', () => {
  it('marks lines that overlap any range', () => {
    const lines = [
      { id: 1, startMs: 0, endMs: 5_000 },
      { id: 2, startMs: 5_000, endMs: 10_000 },
      { id: 3, startMs: 10_000, endMs: 15_000 },
    ];
    expect(linesInClips(lines, [{ startMs: 6_000, endMs: 10_000 }])).toEqual(new Set([2]));
  });
});

describe('visibleClips', () => {
  const clips = [{ startMs: null }, { startMs: 1_000 }];
  it('shows unplaced live highlights only while the meeting is still processing', () => {
    expect(visibleClips(clips, 'in_meeting')).toHaveLength(2);
    expect(visibleClips(clips, 'summarizing')).toHaveLength(2);
    expect(visibleClips(clips, 'ready')).toEqual([{ startMs: 1_000 }]);
    expect(visibleClips(clips, 'failed')).toEqual([{ startMs: 1_000 }]);
  });
});

describe('isShareToken', () => {
  it('accepts 22 base64url characters only', () => {
    expect(isShareToken('abcdefghijklmnopqrstu_')).toBe(true);
    expect(isShareToken('abc')).toBe(false);
    expect(isShareToken('abcdefghijklmnopqrstu/')).toBe(false);
  });
});
