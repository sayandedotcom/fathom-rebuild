import { sql } from 'drizzle-orm';
import { db } from '../db';
import { HIGHLIGHT_END, HIGHLIGHT_START } from './highlight';

export type SearchHit = { meetingId: string; title: string; createdAt: string; startMs: number | null; snippet: string | null };

const HEADLINE_OPTIONS = `StartSel=${HIGHLIGHT_START},StopSel=${HIGHLIGHT_END},MaxWords=25,MinWords=10,MaxFragments=1`;

export async function searchMeetings(query: string): Promise<SearchHit[]> {
  const tsq = sql`websearch_to_tsquery('english', ${query})`;
  const titleHits = await db.execute(sql`
    select id as "meetingId", title, created_at::text as "createdAt", null::int as "startMs", null::text as snippet
    from meetings
    where to_tsvector('english', title) @@ ${tsq}
    order by created_at desc
    limit 20`);
  const lineHits = await db.execute(sql`
    select m.id as "meetingId", m.title, m.created_at::text as "createdAt", u.start_ms as "startMs",
           ts_headline('english', u.text, ${tsq}, ${HEADLINE_OPTIONS}) as snippet
    from utterances u
    join meetings m on m.id = u.meeting_id
    where u.tsv @@ ${tsq}
    order by ts_rank(u.tsv, ${tsq}) desc, m.created_at desc
    limit 50`);
  return [...titleHits.rows, ...lineHits.rows] as SearchHit[];
}
