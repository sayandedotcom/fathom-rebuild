import { sql } from 'drizzle-orm';
import { db } from '../db';
import { speakerName } from '../transcript/speakers';
import { HIGHLIGHT_END, HIGHLIGHT_START } from './highlight';

export type SearchHit = {
  meetingId: string;
  title: string;
  createdAt: string;
  startMs: number | null;
  snippet: string | null;
  speaker: string | null;
};

const HEADLINE_OPTIONS = `StartSel=${HIGHLIGHT_START},StopSel=${HIGHLIGHT_END},MaxWords=25,MinWords=10,MaxFragments=1`;

export async function searchMeetings(query: string): Promise<SearchHit[]> {
  const tsq = sql`websearch_to_tsquery('english', ${query})`;
  const titleHits = await db.execute(sql`
    select id as "meetingId", title, created_at::text as "createdAt", null::int as "startMs", null::text as snippet, null::text as speaker, '{}'::jsonb as "speakerNames"
    from meetings
    where to_tsvector('english', title) @@ ${tsq}
    order by created_at desc
    limit 20`);
  const lineHits = await db.execute(sql`
    select m.id as "meetingId", m.title, m.created_at::text as "createdAt", u.start_ms as "startMs",
           ts_headline('english', u.text, ${tsq}, ${HEADLINE_OPTIONS}) as snippet,
           u.speaker, m.speaker_names as "speakerNames"
    from utterances u
    join meetings m on m.id = u.meeting_id
    where u.tsv @@ ${tsq}
    order by ts_rank(u.tsv, ${tsq}) desc, m.created_at desc
    limit 50`);
  type Row = Omit<SearchHit, 'speaker'> & { speaker: string | null; speakerNames: Record<string, string> };
  return ([...titleHits.rows, ...lineHits.rows] as Row[]).map(({ speakerNames, ...hit }) => ({
    ...hit,
    speaker: hit.speaker === null ? null : speakerName(hit.speaker, speakerNames),
  }));
}
