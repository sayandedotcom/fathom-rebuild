import { describe, expect, it } from 'vitest';
import { MEETING_TEMPLATES, TEMPLATE_LABELS, templateHeadings, templateInstructions } from '../lib/templates';

describe('templates', () => {
  it('has a label for every template', () => {
    expect(MEETING_TEMPLATES.map((t) => TEMPLATE_LABELS[t])).toEqual(['General', 'Sales call', '1:1', 'Standup', 'Interview']);
  });
  it('defines the exact headings per template', () => {
    expect(templateHeadings('general')).toEqual([]);
    expect(templateHeadings('sales')).toEqual(['Customer needs', 'Objections', 'Budget & timeline', 'Next steps']);
    expect(templateHeadings('one_on_one')).toEqual(['Wins', 'Concerns', 'Feedback', 'Follow-ups']);
    expect(templateHeadings('standup')).toEqual(['Yesterday', 'Today', 'Blockers']);
    expect(templateHeadings('interview')).toEqual(['Candidate background', 'Strengths', 'Concerns', 'Recommendation']);
  });
  it('tells Claude the context and headings, in order', () => {
    const sales = templateInstructions('sales');
    expect(sales).toContain('This is a sales call.');
    expect(sales).toContain('"Customer needs", "Objections", "Budget & timeline", "Next steps"');
    expect(templateInstructions('general')).toBe('Leave "sections" as an empty list.');
  });
});
