import { describe, expect, it } from 'vitest';
import { summaryToMarkdown } from '../lib/summary-markdown';

describe('summaryToMarkdown', () => {
  it('renders sections and skips empty ones', () => {
    const md = summaryToMarkdown('Weekly sync', {
      title: '',
      sections: [],
      overview: 'We planned the launch.',
      keyPoints: ['Launch Friday'],
      decisions: [],
      actionItems: [{ task: 'Write post', owner: 'Ana', due: 'Thursday' }, { task: 'QA', owner: null, due: null }],
      keyMoments: [],
      highlights: [],
    });
    expect(md).toBe(
      '# Weekly sync\n\nWe planned the launch.\n\n## Action items\n- [ ] Write post (Ana, Thursday)\n- [ ] QA\n\n## Key points\n- Launch Friday\n',
    );
  });
  it('includes template sections with items after key points', () => {
    const md = summaryToMarkdown('Standup', {
      title: 'Standup',
      overview: 'Daily standup.',
      keyPoints: ['Release is on track'],
      decisions: [],
      actionItems: [],
      keyMoments: [],
      sections: [
        { heading: 'Yesterday', items: ['Fixed login'] },
        { heading: 'Blockers', items: [] },
      ],
      highlights: [],
    });
    expect(md).toBe('# Standup\n\nDaily standup.\n\n## Key points\n- Release is on track\n\n## Yesterday\n- Fixed login\n');
  });
  it('puts highlights right after the overview', () => {
    const md = summaryToMarkdown('Sync', {
      title: '',
      overview: 'Short sync.',
      keyPoints: [],
      decisions: [],
      actionItems: [],
      keyMoments: [],
      sections: [],
      highlights: [{ timestamp: '01:02', label: 'Pricing pushback' }],
    });
    expect(md).toBe('# Sync\n\nShort sync.\n\n## Highlights\n- [01:02] Pricing pushback\n');
  });
});
