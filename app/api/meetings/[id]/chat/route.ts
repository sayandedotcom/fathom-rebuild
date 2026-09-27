import { convertToModelMessages, createUIMessageStreamResponse, streamText, toUIMessageStream, type UIMessage } from 'ai';
import { asc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { meetings, utterances } from '@/lib/db/schema';
import { isUuid } from '@/lib/ids';
import { llm } from '@/lib/llm';
import { chatInstructions } from '@/lib/pipeline/prompts';
import { formatTranscript } from '@/lib/transcript/format';

export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const meeting = await db.query.meetings.findFirst({
    where: eq(meetings.id, id),
    columns: { title: true, status: true },
  });
  if (!meeting) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (meeting.status !== 'ready') return NextResponse.json({ error: 'Meeting is not ready yet' }, { status: 409 });

  const lines = await db
    .select({ speaker: utterances.speaker, startMs: utterances.startMs, text: utterances.text })
    .from(utterances)
    .where(eq(utterances.meetingId, id))
    .orderBy(asc(utterances.startMs));
  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model: llm(),
    instructions: chatInstructions(meeting.title, formatTranscript(lines)),
    messages: await convertToModelMessages(messages),
  });
  return createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream }) });
}
