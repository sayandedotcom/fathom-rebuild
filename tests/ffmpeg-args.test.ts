import { describe, expect, it } from 'vitest';
import { ffmpegCutArgs } from '../lib/clips/ffmpeg';

describe('ffmpegCutArgs', () => {
  it('seeks the input, limits the length and encodes 96k mp3 to stdout', () => {
    expect(ffmpegCutArgs('https://x.blob.vercel-storage.com/a.mp3', 61_500, 96_500)).toEqual([
      '-hide_banner', '-loglevel', 'error',
      '-ss', '61.500',
      '-protocol_whitelist', 'http,tcp',
      '-i', 'https://x.blob.vercel-storage.com/a.mp3',
      '-t', '35.000',
      '-vn', '-c:a', 'libmp3lame', '-b:a', '96k', '-map_metadata', '-1', '-f', 'mp3', 'pipe:1',
    ]);
  });
});
