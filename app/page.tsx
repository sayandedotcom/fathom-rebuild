import { desc } from 'drizzle-orm';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SearchResults } from '@/components/search-results';
import { db } from '@/lib/db';
import { meetings } from '@/lib/db/schema';
import { searchMeetings } from '@/lib/search/search';
import { formatTimestamp } from '@/lib/transcript/format';

export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const { q } = await searchParams;
  const query = typeof q === 'string' ? q.trim() : '';

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Meetings</h1>
        <Link href="/new" className={buttonVariants()}>
          New meeting
        </Link>
      </div>
      <form action="/" className="flex gap-2">
        <Input name="q" defaultValue={query} placeholder="Search all transcripts…" />
        <Button type="submit" variant="secondary">Search</Button>
      </form>
      {query ? <SearchResults query={query} hits={await searchMeetings(query)} /> : <MeetingList />}
    </main>
  );
}

async function MeetingList() {
  const rows = await db
    .select({ id: meetings.id, title: meetings.title, status: meetings.status, durationSec: meetings.durationSec, createdAt: meetings.createdAt, source: meetings.source })
    .from(meetings)
    .orderBy(desc(meetings.createdAt))
    .limit(100);
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No meetings yet. <Link href="/new" className="underline">Upload your first recording.</Link>
      </p>
    );
  }
  return (
    <ul className="divide-y rounded-md border">
      {rows.map((m) => (
        <li key={m.id}>
          <Link href={`/meetings/${m.id}`} className="flex items-center justify-between gap-4 p-3 hover:bg-muted">
            <span className="min-w-0 truncate font-medium">{m.title}</span>
            <span className="flex shrink-0 items-center gap-3 text-sm text-muted-foreground">
              {m.durationSec !== null && formatTimestamp(m.durationSec * 1000)}
              <span>{m.createdAt.toLocaleDateString()}</span>
              {m.source === 'bot' && <Badge variant="outline">bot</Badge>}
              <Badge variant={m.status === 'failed' ? 'destructive' : 'secondary'}>{m.status}</Badge>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
