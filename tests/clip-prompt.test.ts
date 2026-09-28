import { describe, expect, it } from 'vitest';
import { highlightInstructions } from '../lib/pipeline/prompts';

describe('highlightInstructions', () => {
  it('asks for an empty list when nothing was highlighted', () => {
    expect(highlightInstructions([])).toBe('No moments were highlighted, so return an empty highlights list.');
  });
  it('lists the timestamps and asks for one label each', () => {
    const text = highlightInstructions(['01:02', '1:10:00']);
    expect(text).toContain('01:02, 1:10:00');
    expect(text).toContain('copied exactly');
    expect(text).toContain('at most 8 words');
  });
});
