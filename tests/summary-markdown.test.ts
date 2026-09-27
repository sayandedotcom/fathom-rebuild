import { describe, expect, it } from 'vitest';
import { summaryToMarkdown } from '../lib/summary-markdown';

describe('summaryToMarkdown', () => {
  it('renders sections and skips empty ones', () => {
    const md = summaryToMarkdown('Weekly sync', {
      overview: 'We planned the launch.',
      keyPoints: ['Launch Friday'],
      decisions: [],
      actionItems: [{ task: 'Write post', owner: 'Ana', due: 'Thursday' }, { task: 'QA', owner: null, due: null }],
      keyMoments: [],
    });
    expect(md).toBe(
      '# Weekly sync\n\nWe planned the launch.\n\n## Action items\n- [ ] Write post (Ana, Thursday)\n- [ ] QA\n\n## Key points\n- Launch Friday\n',
    );
  });
});
