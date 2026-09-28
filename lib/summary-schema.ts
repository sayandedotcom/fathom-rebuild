import { z } from 'zod';

export const summarySchema = z.object({
  title: z.string().describe('A short descriptive meeting title, at most 8 words, e.g. "Q3 pricing review with Acme"'),
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
  keyMoments: z
    .array(z.object({ timestamp: z.string().describe('Timestamp of the moment exactly as in the transcript, e.g. 12:04'), label: z.string() }))
    .describe('3-8 moments worth jumping to: decisions, disagreements, commitments'),
  sections: z
    .array(z.object({ heading: z.string(), items: z.array(z.string()) }))
    .describe('Template-specific sections; follow the instructions for which headings to use'),
});

export type Summary = z.infer<typeof summarySchema>;

export const EMPTY_SUMMARY: Summary = {
  title: '',
  overview: 'No speech was detected in this recording.',
  keyPoints: [],
  decisions: [],
  actionItems: [],
  keyMoments: [],
  sections: [],
};
