import { generateText } from 'ai';
import { llm, MODEL_ID } from '../lib/llm';

async function main() {
  const { text } = await generateText({ model: llm(), prompt: 'Reply with exactly the word: ok' });
  console.log(`${MODEL_ID} -> ${text}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
