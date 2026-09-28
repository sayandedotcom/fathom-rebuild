import { describe, expect, it } from 'vitest';
import { pickAutoTitle, resolveCreateTitle, UNTITLED } from '../lib/titles';

describe('resolveCreateTitle', () => {
  it('marks an empty title as auto', () => {
    expect(resolveCreateTitle('   ')).toEqual({ title: UNTITLED, titleIsAuto: true });
    expect(resolveCreateTitle('')).toEqual({ title: 'Untitled meeting', titleIsAuto: true });
  });
  it('keeps a typed title', () => {
    expect(resolveCreateTitle('  Weekly sync ')).toEqual({ title: 'Weekly sync', titleIsAuto: false });
  });
});

describe('pickAutoTitle', () => {
  it('uses the summary title only for auto-titled meetings', () => {
    expect(pickAutoTitle(true, ' Q3 pricing review ')).toBe('Q3 pricing review');
    expect(pickAutoTitle(false, 'Q3 pricing review')).toBeNull();
    expect(pickAutoTitle(true, '  ')).toBeNull();
    expect(pickAutoTitle(true, undefined)).toBeNull();
  });
});
