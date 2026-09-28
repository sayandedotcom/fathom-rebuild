import { del } from '@vercel/blob';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { clips } from '@/lib/db/schema';
import { isUuid } from '@/lib/ids';

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  // Delete first (with RETURNING) so a cut finishing concurrently can't write a fresh audio_url after we've
  // already read the old one and moved on, leaving that new Blob orphaned. A cut still running finds no row
  // once it tries to flip status to 'ready', and cutClip then deletes the file it just made.
  const [deleted] = await db.delete(clips).where(eq(clips.id, id)).returning({ audioUrl: clips.audioUrl });
  if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (deleted.audioUrl) await del(deleted.audioUrl).catch((err) => console.error('Blob delete of clip failed', id, err));
  return new NextResponse(null, { status: 204 });
}
