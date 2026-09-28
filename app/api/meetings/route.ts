import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { meetings } from '@/lib/db/schema';
import { MAX_DURATION_SEC } from '@/lib/limits';
import { submitTranscription } from '@/lib/pipeline/assemblyai';
import { MEETING_TEMPLATES } from '@/lib/templates';
import { resolveCreateTitle } from '@/lib/titles';

const createSchema = z.object({
  title: z.string().trim().max(200).default(''),
  template: z.enum(MEETING_TEMPLATES).default('general'),
  audioUrl: z.url().refine((u) => {
    const url = new URL(u);
    return url.protocol === 'https:' && url.hostname.endsWith('.blob.vercel-storage.com');
  }, 'audioUrl must be a Vercel Blob URL'),
  durationSec: z.number().int().nonnegative().max(MAX_DURATION_SEC).nullable(),
  source: z.enum(['upload', 'record']).default('upload'),
});

export async function POST(req: Request) {
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  }
  let assemblyaiId: string;
  try {
    assemblyaiId = await submitTranscription(parsed.data.audioUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Could not start transcription: ${message}` }, { status: 502 });
  }
  const [meeting] = await db
    .insert(meetings)
    .values({ ...parsed.data, ...resolveCreateTitle(parsed.data.title), assemblyaiId })
    .returning({ id: meetings.id });
  return NextResponse.json({ id: meeting.id }, { status: 201 });
}
