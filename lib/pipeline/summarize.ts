import { generateText, NoObjectGeneratedError, Output } from 'ai';
import { llm } from '../llm';
import { type Summary, summarySchema } from '../summary-schema';
import { type MeetingTemplate, templateInstructions } from '../templates';
import { SUMMARY_INSTRUCTIONS } from './prompts';

export async function summarize(transcript: string, template: MeetingTemplate = 'general'): Promise<Summary> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { output } = await generateText({
        model: llm(),
        instructions: `${SUMMARY_INSTRUCTIONS}\n\n${templateInstructions(template)}`,
        prompt: transcript,
        output: Output.object({ schema: summarySchema }),
      });
      return output;
    } catch (err) {
      if (!NoObjectGeneratedError.isInstance(err)) throw err;
      lastError = err;
    }
  }
  throw lastError;
}
