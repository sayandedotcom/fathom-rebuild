import { del } from '@vercel/blob';
import { eq } from 'drizzle-orm';
import { after, NextResponse } from 'next/server';
import { z } from 'zod';
import { leaveCall } from '@/lib/bot/recall';
import { db } from '@/lib/db';
import { meetings } from '@/lib/db/schema';
import { isUuid } from '@/lib/ids';
import { advanceMeeting } from '@/lib/pipeline/advance';
import { startResummarize } from '@/lib/pipeline/resummarize';
import { MEETING_TEMPLATES } from '@/lib/templates';

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

const patchSchema = z
  .object({ title: z.string().trim().min(1).max(200).optional(), template: z.enum(MEETING_TEMPLATES).optional() })
  .refine((b) => b.title !== undefined || b.template !== undefined, 'Nothing to update');

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  const { title, template } = parsed.data;
  const [updated] = await db
    .update(meetings)
    .set({ ...(title !== undefined && { title, titleIsAuto: false }), ...(template !== undefined && { template }) })
    .where(eq(meetings.id, id))
    .returning({ title: meetings.title, template: meetings.template, status: meetings.status });
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const started = template !== undefined && updated.status === 'ready' && (await startResummarize(id));
  return NextResponse.json({ ...updated, status: started ? 'summarizing' : updated.status });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const meeting = await db.query.meetings.findFirst({
    where: eq(meetings.id, id),
    columns: { status: true, recallBotId: true, audioUrl: true },
  });
  if (!meeting) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (meeting.status === 'in_meeting' && meeting.recallBotId) {
    await leaveCall(meeting.recallBotId).catch((err) => console.error('Recall leaveCall on delete failed', id, err));
  }
  if (meeting.audioUrl) {
    await del(meeting.audioUrl).catch((err) => console.error('Blob delete failed', id, err));
  }
  // Utterances go with the row (ON DELETE CASCADE); background work for this meeting then updates nothing.
  await db.delete(meetings).where(eq(meetings.id, id));
  return new NextResponse(null, { status: 204 });
}
