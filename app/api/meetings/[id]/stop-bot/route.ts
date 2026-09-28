import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { STOPPING_REQUESTED } from '@/lib/bot/advance-bot';
import { leaveCall } from '@/lib/bot/recall';
import { db } from '@/lib/db';
import { meetings } from '@/lib/db/schema';
import { isUuid } from '@/lib/ids';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const meeting = await db.query.meetings.findFirst({
    where: eq(meetings.id, id),
    columns: { status: true, recallBotId: true },
  });
  if (!meeting) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (meeting.status !== 'in_meeting' || !meeting.recallBotId) {
    return NextResponse.json({ error: 'The bot is not in a meeting' }, { status: 409 });
  }
  try {
    await leaveCall(meeting.recallBotId);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
  await db
    .update(meetings)
    .set({ botStatus: STOPPING_REQUESTED })
    .where(and(eq(meetings.id, id), eq(meetings.status, 'in_meeting')));
  return NextResponse.json({ ok: true }, { status: 202 });
}
