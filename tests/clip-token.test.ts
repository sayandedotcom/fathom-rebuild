import { describe, expect, it } from 'vitest';
import { isShareToken } from '../lib/clips/logic';
import { newShareToken } from '../lib/clips/token';

describe('newShareToken', () => {
  it('makes distinct 22-character base64url tokens', () => {
    const a = newShareToken();
    const b = newShareToken();
    expect(isShareToken(a)).toBe(true);
    expect(a).not.toBe(b);
  });
});
