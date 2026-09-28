import { and, count, eq } from 'drizzle-orm';
import { after, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { meetings, utterances } from '@/lib/db/schema';
import { isUuid } from '@/lib/ids';
import { copyBotAudioAndSubmit } from '@/lib/bot/finish';
import { submitTranscription } from '@/lib/pipeline/assemblyai';
import { summarizeMeeting } from '@/lib/pipeline/advance';

export const maxDuration = 300;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const meeting = await db.query.meetings.findFirst({ where: eq(meetings.id, id), columns: { status: true, audioUrl: true, recallBotId: true } });
  if (!meeting) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (meeting.status !== 'failed') return NextResponse.json({ error: 'Only failed meetings can be retried' }, { status: 409 });

  const [{ n }] = await db.select({ n: count() }).from(utterances).where(eq(utterances.meetingId, id));
  const isFailed = and(eq(meetings.id, id), eq(meetings.status, 'failed'));

  if (n > 0) {
    const claimed = await db.update(meetings).set({ status: 'summarizing', error: null }).where(isFailed).returning({ id: meetings.id });
    if (claimed.length === 0) return NextResponse.json({ error: 'Already retrying' }, { status: 409 });
    after(() => summarizeMeeting(id));
    return NextResponse.json({ status: 'summarizing' }, { status: 202 });
  }

  if (!meeting.audioUrl) {
    if (!meeting.recallBotId) return NextResponse.json({ error: 'This meeting has no recording to retry' }, { status: 409 });
    const claimed = await db
      .update(meetings)
      .set({ status: 'transcribing', error: null, assemblyaiId: null })
      .where(isFailed)
      .returning({ id: meetings.id });
    if (claimed.length === 0) return NextResponse.json({ error: 'Already retrying' }, { status: 409 });
    after(() => copyBotAudioAndSubmit(id));
    return NextResponse.json({ status: 'transcribing' }, { status: 202 });
  }

  let assemblyaiId: string;
  try {
    assemblyaiId = await submitTranscription(meeting.audioUrl);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
  const claimed = await db.update(meetings).set({ status: 'transcribing', error: null, assemblyaiId }).where(isFailed).returning({ id: meetings.id });
  if (claimed.length === 0) return NextResponse.json({ error: 'Already retrying' }, { status: 409 });
  return NextResponse.json({ status: 'transcribing' }, { status: 202 });
}
