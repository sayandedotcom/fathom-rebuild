import { asc, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { MeetingView } from '@/components/meeting-view';
import { db } from '@/lib/db';
import { meetings, utterances } from '@/lib/db/schema';
import { isUuid } from '@/lib/ids';
import { parseSeekParam } from '@/lib/transcript/format';

export default async function MeetingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string | string[] }>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const meeting = await db.query.meetings.findFirst({ where: eq(meetings.id, id) });
  if (!meeting) notFound();
  const lines = await db
    .select({ id: utterances.id, speaker: utterances.speaker, startMs: utterances.startMs, text: utterances.text })
    .from(utterances)
    .where(eq(utterances.meetingId, id))
    .orderBy(asc(utterances.startMs));
  const { t } = await searchParams;

  return (
    <MeetingView
      meeting={{
        id: meeting.id,
        title: meeting.title,
        status: meeting.status,
        error: meeting.error,
        audioUrl: meeting.audioUrl,
        source: meeting.source,
        botStatus: meeting.botStatus,
        durationSec: meeting.durationSec,
        createdAt: meeting.createdAt.toISOString(),
        summary: meeting.summary,
      }}
      lines={lines}
      initialSeekMs={parseSeekParam(t)}
    />
  );
}
