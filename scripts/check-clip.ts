import { writeFileSync } from 'node:fs';
import { cutAudio } from '../lib/clips/ffmpeg';

// Usage: npm run check:clip -- <audio url> <startMs> <endMs> <out.mp3>
async function main() {
  const [url, start, end, out] = process.argv.slice(2);
  if (!url || !start || !end || !out) {
    console.error('usage: check:clip <audio url> <startMs> <endMs> <out.mp3>');
    process.exit(1);
  }
  const t0 = Date.now();
  const audio = await cutAudio(url, Number(start), Number(end));
  writeFileSync(out, audio);
  console.log(`wrote ${audio.length} bytes in ${Date.now() - t0}ms to ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
