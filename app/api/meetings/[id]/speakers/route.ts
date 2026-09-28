import { and, eq, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { meetings, utterances } from '@/lib/db/schema';
import { isUuid } from '@/lib/ids';
import { startResummarize } from '@/lib/pipeline/resummarize';

export const maxDuration = 300;

const renameSchema = z.object({
  label: z.string().min(1).max(10),
  name: z.string().trim().max(60),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const parsed = renameSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  const { label, name } = parsed.data;

  const meeting = await db.query.meetings.findFirst({ where: eq(meetings.id, id), columns: { id: true } });
  if (!meeting) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const [used] = await db
    .select({ id: utterances.id })
    .from(utterances)
    .where(and(eq(utterances.meetingId, id), eq(utterances.speaker, label)))
    .limit(1);
  if (!used) return NextResponse.json({ error: `Speaker ${label} is not in this meeting` }, { status: 400 });

  const next = name
    ? sql`${meetings.speakerNames} || jsonb_build_object(${label}::text, ${name}::text)`
    : sql`${meetings.speakerNames} - ${label}::text`;
  const [updated] = await db
    .update(meetings)
    .set({ speakerNames: next })
    .where(eq(meetings.id, id))
    .returning({ speakerNames: meetings.speakerNames, status: meetings.status });
  const started = updated.status === 'ready' && (await startResummarize(id));
  return NextResponse.json({ speakerNames: updated.speakerNames, status: started ? 'summarizing' : updated.status });
}
