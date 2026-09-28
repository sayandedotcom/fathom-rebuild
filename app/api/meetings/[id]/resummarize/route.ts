import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { meetings } from '@/lib/db/schema';
import { isUuid } from '@/lib/ids';
import { startResummarize } from '@/lib/pipeline/resummarize';

export const maxDuration = 300;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const meeting = await db.query.meetings.findFirst({ where: eq(meetings.id, id), columns: { id: true } });
  if (!meeting) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!(await startResummarize(id))) return NextResponse.json({ error: 'Only ready meetings can be re-summarized' }, { status: 409 });
  return NextResponse.json({ status: 'summarizing' }, { status: 202 });
}
