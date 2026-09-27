import { describe, expect, it } from 'vitest';
import { isUuid } from '../lib/ids';

describe('isUuid', () => {
  it('accepts a v4 uuid', () => expect(isUuid('3f1c2a9e-6b1d-4c1e-9a7b-2d4e5f6a7b8c')).toBe(true));
  it('rejects junk', () => {
    expect(isUuid('abc')).toBe(false);
    expect(isUuid("1' or 1=1")).toBe(false);
  });
});
