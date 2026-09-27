import { getTranscription, submitTranscription } from '../lib/pipeline/assemblyai';
import { mapUtterances } from '../lib/pipeline/map-utterances';
import { summarize } from '../lib/pipeline/summarize';
import { formatTranscript } from '../lib/transcript/format';

async function main() {
  const id = await submitTranscription('https://assembly.ai/wildfires.mp3');
  console.log('submitted', id);
  let t = await getTranscription(id);
  while (t.status === 'queued' || t.status === 'processing') {
    await new Promise((r) => setTimeout(r, 3000));
    t = await getTranscription(id);
  }
  if (t.status === 'error') throw new Error(t.error);
  const rows = mapUtterances('check', t.utterances);
  console.log('speakers', new Set(rows.map((r) => r.speaker)));
  console.log(JSON.stringify(await summarize(formatTranscript(rows)), null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
