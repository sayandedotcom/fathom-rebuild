import { eq } from 'drizzle-orm';
import { after, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { meetings } from '@/lib/db/schema';
import { isUuid } from '@/lib/ids';
import { advanceMeeting } from '@/lib/pipeline/advance';

export const maxDuration = 300;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const meeting = await db.query.meetings.findFirst({
    where: eq(meetings.id, id),
    columns: { status: true, error: true, botStatus: true },
  });
  if (!meeting) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (meeting.status === 'in_meeting' || meeting.status === 'transcribing' || meeting.status === 'summarizing') {
    after(() => advanceMeeting(id));
  }
  return NextResponse.json(meeting, { headers: { 'cache-control': 'no-store' } });
}
