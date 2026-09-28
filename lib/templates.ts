export const MEETING_TEMPLATES = ['general', 'sales', 'one_on_one', 'standup', 'interview'] as const;
export type MeetingTemplate = (typeof MEETING_TEMPLATES)[number];

export const TEMPLATE_LABELS: Record<MeetingTemplate, string> = {
  general: 'General',
  sales: 'Sales call',
  one_on_one: '1:1',
  standup: 'Standup',
  interview: 'Interview',
};

const SPECS: Record<MeetingTemplate, { context: string; headings: string[] } | null> = {
  general: null,
  sales: { context: 'This is a sales call.', headings: ['Customer needs', 'Objections', 'Budget & timeline', 'Next steps'] },
  one_on_one: { context: 'This is a 1:1 between a manager and a report.', headings: ['Wins', 'Concerns', 'Feedback', 'Follow-ups'] },
  standup: { context: 'This is a team standup.', headings: ['Yesterday', 'Today', 'Blockers'] },
  interview: { context: 'This is a job interview.', headings: ['Candidate background', 'Strengths', 'Concerns', 'Recommendation'] },
};

export function templateHeadings(template: MeetingTemplate): string[] {
  return SPECS[template]?.headings ?? [];
}

export function templateInstructions(template: MeetingTemplate): string {
  const spec = SPECS[template];
  if (!spec) return 'Leave "sections" as an empty list.';
  const headings = spec.headings.map((h) => `"${h}"`).join(', ');
  return `${spec.context} Fill "sections" with exactly these headings, in this order: ${headings}. Each item is one sentence. If a heading has nothing to report, give it an empty items list; never invent content.`;
}
