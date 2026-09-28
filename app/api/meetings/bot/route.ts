import { count, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isMeetUrl } from '@/lib/bot/meet-url';
import { BOT_TEXT } from '@/lib/bot/outcome';
import { createBot } from '@/lib/bot/recall';
import { db } from '@/lib/db';
import { meetings } from '@/lib/db/schema';
import { MAX_ACTIVE_BOTS } from '@/lib/limits';

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  meetingUrl: z
    .string()
    .trim()
    .refine(isMeetUrl, 'meetingUrl must be a Google Meet link like https://meet.google.com/abc-defg-hij'),
});

export async function POST(req: Request) {
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  const [{ active }] = await db.select({ active: count() }).from(meetings).where(eq(meetings.status, 'in_meeting'));
  if (active >= MAX_ACTIVE_BOTS) {
    return NextResponse.json({ error: `${MAX_ACTIVE_BOTS} bots are already in meetings. Try again when one finishes.` }, { status: 429 });
  }
  const id = crypto.randomUUID();
  let recallBotId: string;
  try {
    recallBotId = await createBot(parsed.data.meetingUrl, id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Could not start the bot: ${message}` }, { status: 502 });
  }
  await db.insert(meetings).values({
    id,
    title: parsed.data.title,
    source: 'bot',
    status: 'in_meeting',
    recallBotId,
    botStatus: BOT_TEXT.joining,
  });
  return NextResponse.json({ id }, { status: 201 });
}
