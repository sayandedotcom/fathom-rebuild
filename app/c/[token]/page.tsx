import { and, asc, eq, gt, lt } from 'drizzle-orm';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { excerptLines, isShareToken } from '@/lib/clips/logic';
import { db } from '@/lib/db';
import { clips, meetings, utterances } from '@/lib/db/schema';
import { formatTimestamp } from '@/lib/transcript/format';
import { speakerName } from '@/lib/transcript/speakers';

// Only clip fields and the meeting's title and names are selected: the meeting's own audio URL never reaches this page.
const loadClip = cache(async (token: string) => {
  if (!isShareToken(token)) return null;
  const [row] = await db
    .select({
      title: clips.title,
      status: clips.status,
      startMs: clips.startMs,
      endMs: clips.endMs,
      audioUrl: clips.audioUrl,
      meetingId: clips.meetingId,
      meetingTitle: meetings.title,
      speakerNames: meetings.speakerNames,
    })
    .from(clips)
    .innerJoin(meetings, eq(meetings.id, clips.meetingId))
    .where(eq(clips.shareToken, token));
  return row ?? null;
});

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const clip = await loadClip((await params).token);
  if (!clip) return { title: 'Clip not found' };
  const title = clip.title || 'Meeting clip';
  const length = clip.startMs !== null && clip.endMs !== null ? `${formatTimestamp(clip.endMs - clip.startMs)} ` : '';
  const description = `A ${length}clip from “${clip.meetingTitle}”`;
  return { title, description, openGraph: { title, description, type: 'website' }, robots: { index: false } };
}

export default async function ClipPage({ params }: { params: Promise<{ token: string }> }) {
  const clip = await loadClip((await params).token);
  if (!clip) notFound();

  if (clip.status !== 'ready' || !clip.audioUrl || clip.startMs === null || clip.endMs === null) {
    return (
      <main className="mx-auto w-full max-w-2xl p-6">
        <p className="text-muted-foreground">This clip is still being prepared.</p>
      </main>
    );
  }

  const overlapping = await db
    .select({ id: utterances.id, speaker: utterances.speaker, startMs: utterances.startMs, endMs: utterances.endMs, text: utterances.text })
    .from(utterances)
    .where(and(eq(utterances.meetingId, clip.meetingId), lt(utterances.startMs, clip.endMs), gt(utterances.endMs, clip.startMs)))
    .orderBy(asc(utterances.startMs));
  const clipStart = clip.startMs;
  const lines = excerptLines(overlapping, { startMs: clip.startMs, endMs: clip.endMs });

  return (
    <main className="mx-auto w-full max-w-2xl space-y-4 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{clip.title || 'Meeting clip'}</h1>
        <p className="text-sm text-muted-foreground">from {clip.meetingTitle}</p>
      </header>
      <audio src={clip.audioUrl} controls preload="metadata" className="w-full" />
      <ol className="space-y-3 text-sm">
        {lines.map((l) => (
          <li key={l.id}>
            <span className="mr-2 font-mono text-xs text-muted-foreground">{formatTimestamp(Math.max(0, l.startMs - clipStart))}</span>
            <span className="font-medium">{speakerName(l.speaker, clip.speakerNames)}</span>
            <p className="mt-1 leading-relaxed">
              {l.partial ? '… ' : ''}
              {l.text}
            </p>
          </li>
        ))}
      </ol>
      <p className="pt-4 text-xs text-muted-foreground">Shared with Fanthom</p>
    </main>
  );
}
