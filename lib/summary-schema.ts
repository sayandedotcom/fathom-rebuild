import { z } from 'zod';

export const summarySchema = z.object({
  overview: z.string().describe('2-4 sentence overview of what the meeting was about and its outcome'),
  keyPoints: z.array(z.string()).describe('Most important points discussed, one sentence each'),
  decisions: z.array(z.string()).describe('Decisions that were explicitly agreed; empty if none'),
  actionItems: z
    .array(
      z.object({
        task: z.string(),
        owner: z.string().nullable().describe('Person responsible if stated or clearly implied, else null'),
        due: z.string().nullable().describe('Deadline as stated in the meeting, else null'),
      }),
    )
    .describe('Concrete follow-up tasks; empty if none'),
});

export type Summary = z.infer<typeof summarySchema>;

export const EMPTY_SUMMARY: Summary = {
  overview: 'No speech was detected in this recording.',
  keyPoints: [],
  decisions: [],
  actionItems: [],
};
