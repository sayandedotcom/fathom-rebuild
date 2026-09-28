import { del } from '@vercel/blob';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { clips } from '@/lib/db/schema';
import { isUuid } from '@/lib/ids';

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const [clip] = await db.select({ audioUrl: clips.audioUrl }).from(clips).where(eq(clips.id, id));
  if (!clip) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (clip.audioUrl) await del(clip.audioUrl).catch((err) => console.error('Blob delete of clip failed', id, err));
  // A cut still running finds no row, and cutClip then deletes the file it just made.
  await db.delete(clips).where(eq(clips.id, id));
  return new NextResponse(null, { status: 204 });
}
