import { describe, expect, it } from 'vitest';
import { splitHighlights } from '../lib/search/highlight';

describe('splitHighlights', () => {
  it('splits marked terms', () => {
    expect(splitHighlights('we ⟦ship⟧ the ⟦pricing⟧ page')).toEqual([
      { text: 'we ', match: false },
      { text: 'ship', match: true },
      { text: ' the ', match: false },
      { text: 'pricing', match: true },
      { text: ' page', match: false },
    ]);
  });
  it('returns plain text unchanged, including HTML-looking text', () => {
    expect(splitHighlights('<b>hi</b>')).toEqual([{ text: '<b>hi</b>', match: false }]);
  });
  it('handles an empty string', () => {
    expect(splitHighlights('')).toEqual([]);
  });
});
