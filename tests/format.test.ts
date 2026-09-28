import { describe, expect, it } from 'vitest';
import { formatTimestamp, formatTranscript, parseSeekParam } from '../lib/transcript/format';

describe('formatTimestamp', () => {
  it('pads minutes and seconds under an hour', () => {
    expect(formatTimestamp(0)).toBe('00:00');
    expect(formatTimestamp(65_000)).toBe('01:05');
    expect(formatTimestamp(59_999)).toBe('00:59');
  });
  it('uses h:mm:ss from one hour', () => {
    expect(formatTimestamp(3_600_000)).toBe('1:00:00');
    expect(formatTimestamp(3_725_000)).toBe('1:02:05');
  });
});

describe('formatTranscript', () => {
  it('renders one line per utterance', () => {
    expect(
      formatTranscript([
        { speaker: 'A', startMs: 0, text: 'Hi all.' },
        { speaker: 'B', startMs: 65_000, text: 'Pricing next.' },
      ]),
    ).toBe('[00:00] Speaker A: Hi all.\n[01:05] Speaker B: Pricing next.');
  });
});

describe('parseSeekParam', () => {
  it('accepts non-negative integer milliseconds', () => {
    expect(parseSeekParam('0')).toBe(0);
    expect(parseSeekParam('65000')).toBe(65000);
  });
  it('rejects anything else', () => {
    expect(parseSeekParam(undefined)).toBeNull();
    expect(parseSeekParam('abc')).toBeNull();
    expect(parseSeekParam('-5')).toBeNull();
    expect(parseSeekParam('1.5')).toBeNull();
    expect(parseSeekParam(['1', '2'])).toBeNull();
  });
});

describe('formatTranscript with names', () => {
  it('uses saved names and keeps letters for the rest', () => {
    expect(
      formatTranscript(
        [
          { speaker: 'A', startMs: 0, text: 'Hi.' },
          { speaker: 'B', startMs: 1_000, text: 'Hello.' },
        ],
        { A: 'Priya' },
      ),
    ).toBe('[00:00] Priya: Hi.\n[00:01] Speaker B: Hello.');
  });
});
