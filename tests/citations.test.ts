import { describe, expect, it } from 'vitest';
import { parseCitations, timestampToMs } from '../lib/chat/citations';

describe('timestampToMs', () => {
  it('parses mm:ss and h:mm:ss', () => {
    expect(timestampToMs('01:05')).toBe(65_000);
    expect(timestampToMs('1:02:05')).toBe(3_725_000);
  });
  it('rejects invalid labels', () => {
    expect(timestampToMs('1:75')).toBeNull();
    expect(timestampToMs('abc')).toBeNull();
  });
});

describe('parseCitations', () => {
  it('splits text and citations', () => {
    expect(parseCitations('Ship Friday [12:04], confirmed [1:00:10].')).toEqual([
      { type: 'text', text: 'Ship Friday ' },
      { type: 'cite', label: '12:04', ms: 724_000 },
      { type: 'text', text: ', confirmed ' },
      { type: 'cite', label: '1:00:10', ms: 3_610_000 },
      { type: 'text', text: '.' },
    ]);
  });
  it('leaves non-timestamp brackets as text', () => {
    expect(parseCitations('see [note]')).toEqual([{ type: 'text', text: 'see [note]' }]);
  });
});
