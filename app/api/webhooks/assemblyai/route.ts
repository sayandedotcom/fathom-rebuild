import { eq } from 'drizzle-orm';
import { after, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { meetings } from '@/lib/db/schema';
import { requireEnv } from '@/lib/env';
import { advanceMeeting } from '@/lib/pipeline/advance';

export const maxDuration = 300;

export async function POST(req: Request) {
  const secret = new URL(req.url).searchParams.get('secret');
  if (secret !== requireEnv('WEBHOOK_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as { transcript_id?: string } | null;
  if (!body?.transcript_id) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  const meeting = await db.query.meetings.findFirst({
    where: eq(meetings.assemblyaiId, body.transcript_id),
    columns: { id: true },
  });
  if (meeting) after(() => advanceMeeting(meeting.id));
  return NextResponse.json({ ok: true });
}
