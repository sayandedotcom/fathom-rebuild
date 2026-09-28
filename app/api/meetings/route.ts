import { NextResponse } from 'next/server';
import { z } from 'zod';
import { clips, meetings } from '@/lib/db/schema';
import { db } from '@/lib/db';
import { MAX_CLIPS_PER_MEETING } from '@/lib/clips/logic';
import { newShareToken } from '@/lib/clips/token';
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
  highlights: z.array(z.number().int().nonnegative().max(MAX_DURATION_SEC * 1000)).max(MAX_CLIPS_PER_MEETING).default([]),
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
  const { highlights, ...values } = parsed.data;
  const [meeting] = await db
    .insert(meetings)
    .values({ ...values, ...resolveCreateTitle(values.title), assemblyaiId })
    .returning({ id: meetings.id });
  // Marks past the end of the recording are clamped when the clip is placed.
  if (highlights.length > 0) {
    await db.insert(clips).values(highlights.map((markMs) => ({ meetingId: meeting.id, origin: 'live' as const, markMs, shareToken: newShareToken() })));
  }
  return NextResponse.json({ id: meeting.id }, { status: 201 });
}
