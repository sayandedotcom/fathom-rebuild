import { describe, expect, it } from 'vitest';
import { MAX_UPLOAD_BYTES, validateMediaFile } from '../lib/limits';

describe('validateMediaFile', () => {
  it('accepts audio and video under the limit', () => {
    expect(validateMediaFile({ type: 'audio/mpeg', size: 1000 })).toBeNull();
    expect(validateMediaFile({ type: 'video/mp4', size: MAX_UPLOAD_BYTES })).toBeNull();
    expect(validateMediaFile({ type: 'audio/webm;codecs=opus', size: 1 })).toBeNull();
  });
  it('rejects other types, empty type, empty and oversized files', () => {
    expect(validateMediaFile({ type: 'text/plain', size: 10 })).toMatch(/audio or video/);
    expect(validateMediaFile({ type: '', size: 10 })).toMatch(/audio or video/);
    expect(validateMediaFile({ type: 'audio/mpeg', size: 0 })).toMatch(/empty/);
    expect(validateMediaFile({ type: 'audio/mpeg', size: MAX_UPLOAD_BYTES + 1 })).toMatch(/500MB/);
  });
});
