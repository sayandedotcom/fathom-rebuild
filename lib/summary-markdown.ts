import type { Summary } from './summary-schema';

export function summaryToMarkdown(title: string, s: Summary): string {
  const out = [`# ${title}`, '', s.overview, ''];
  const section = (heading: string, items: string[]) => {
    if (items.length === 0) return;
    out.push(`## ${heading}`, ...items, '');
  };
  section(
    'Action items',
    s.actionItems.map((a) => {
      const meta = [a.owner, a.due].filter(Boolean).join(', ');
      return `- [ ] ${a.task}${meta ? ` (${meta})` : ''}`;
    }),
  );
  section('Key points', s.keyPoints.map((p) => `- ${p}`));
  section('Decisions', s.decisions.map((d) => `- ${d}`));
  return out.join('\n');
}
