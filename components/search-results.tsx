import Link from 'next/link';
import { splitHighlights } from '@/lib/search/highlight';
import type { SearchHit } from '@/lib/search/search';
import { formatTimestamp } from '@/lib/transcript/format';

export function SearchResults({ query, hits }: { query: string; hits: SearchHit[] }) {
  if (hits.length === 0) return <p className="text-sm text-muted-foreground">No results for “{query}”.</p>;
  return (
    <ul className="divide-y rounded-md border">
      {hits.map((h, i) => (
        <li key={`${h.meetingId}-${h.startMs ?? 'title'}-${i}`}>
          <Link href={h.startMs === null ? `/meetings/${h.meetingId}` : `/meetings/${h.meetingId}?t=${h.startMs}`} className="block p-3 hover:bg-muted">
            <div className="flex justify-between text-sm font-medium">
              <span>{h.title}</span>
              {h.startMs !== null && <span className="font-mono text-xs text-muted-foreground">{formatTimestamp(h.startMs)}</span>}
            </div>
            {h.snippet && (
              <p className="mt-1 text-sm text-muted-foreground">
                {h.speaker && <span className="font-medium text-foreground">{h.speaker}: </span>}
                {splitHighlights(h.snippet).map((p, j) =>
                  p.match ? <mark key={j} className="rounded bg-yellow-200 px-0.5 text-foreground">{p.text}</mark> : <span key={j}>{p.text}</span>,
                )}
              </p>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
