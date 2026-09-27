import { anthropic } from '@ai-sdk/anthropic';

export const MODEL_ID = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5';

export function llm() {
  return anthropic(MODEL_ID);
}
