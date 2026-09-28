import { eq } from 'drizzle-orm';
import { after, NextResponse } from 'next/server';
import { cutClip } from '@/lib/clips/cut';
import { db } from '@/lib/db';
import { clips } from '@/lib/db/schema';
import { isUuid } from '@/lib/ids';

export const maxDuration = 300;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const [clip] = await db.select({ status: clips.status, startMs: clips.startMs }).from(clips).where(eq(clips.id, id));
  if (!clip) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (clip.status !== 'failed' || clip.startMs === null) {
    return NextResponse.json({ error: 'Only failed clips can be retried' }, { status: 409 });
  }
  after(() => cutClip(id));
  return NextResponse.json({ status: 'cutting' }, { status: 202 });
}
