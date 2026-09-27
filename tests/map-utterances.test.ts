import { describe, expect, it } from 'vitest';
import { mapUtterances } from '../lib/pipeline/map-utterances';

describe('mapUtterances', () => {
  it('maps AssemblyAI utterances to rows', () => {
    expect(mapUtterances('m1', [{ speaker: 'A', start: 120.4, end: 2300.6, text: ' Hello there. ' }])).toEqual([
      { meetingId: 'm1', speaker: 'A', startMs: 120, endMs: 2301, text: 'Hello there.' },
    ]);
  });
  it('returns [] for null, undefined or empty input (no speech)', () => {
    expect(mapUtterances('m1', null)).toEqual([]);
    expect(mapUtterances('m1', undefined)).toEqual([]);
    expect(mapUtterances('m1', [])).toEqual([]);
  });
  it('drops blank utterances', () => {
    expect(mapUtterances('m1', [{ speaker: 'A', start: 0, end: 10, text: '   ' }])).toEqual([]);
  });
});
