import { and, asc, count, eq, gte, lt } from 'drizzle-orm';
import { after, NextResponse } from 'next/server';
import { z } from 'zod';
import { recordingStartedAt } from '@/lib/bot/outcome';
import { getBot, type RecallBot } from '@/lib/bot/recall';
import { cutClip } from '@/lib/clips/cut';
import { botHighlightOffset, clipTitleFromText, MAX_CLIPS_PER_MEETING, selectionRange } from '@/lib/clips/logic';
import { newShareToken } from '@/lib/clips/token';
import { db } from '@/lib/db';
import { clips, meetings, utterances } from '@/lib/db/schema';
import { isUuid } from '@/lib/ids';

export const maxDuration = 300;

const bodySchema = z.discriminatedUnion('origin', [
  z.object({ origin: z.literal('live') }),
  z.object({ origin: z.literal('manual'), startMs: z.number().int().nonnegative(), endMs: z.number().int().nonnegative() }),
]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  const meeting = await db.query.meetings.findFirst({
    where: eq(meetings.id, id),
    columns: { status: true, recallBotId: true, audioUrl: true, durationSec: true },
  });
  if (!meeting) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const [{ n }] = await db.select({ n: count() }).from(clips).where(eq(clips.meetingId, id));
  if (n >= MAX_CLIPS_PER_MEETING) return NextResponse.json({ error: 'This meeting already has 50 clips.' }, { status: 409 });

  if (parsed.data.origin === 'live') {
    if (meeting.status !== 'in_meeting' || !meeting.recallBotId) {
      return NextResponse.json({ error: 'Highlights can only be added while the bot is in the meeting.' }, { status: 409 });
    }
    let bot: RecallBot;
    try {
      bot = await getBot(meeting.recallBotId);
    } catch (err) {
      console.error('Recall getBot for highlight failed', id, err);
      return NextResponse.json({ error: 'Could not reach the meeting bot. Try again.' }, { status: 502 });
    }
    // Server time against Recall's recording start, so the viewer's clock can't skew the mark.
    const markMs = botHighlightOffset(new Date(), recordingStartedAt(bot.status_changes));
    if (markMs === null) return NextResponse.json({ error: "The bot isn't recording yet." }, { status: 409 });
    const [clip] = await db
      .insert(clips)
      .values({ meetingId: id, origin: 'live', markMs, shareToken: newShareToken() })
      .returning({ id: clips.id });
    return NextResponse.json({ id: clip.id, markMs }, { status: 201 });
  }

  if (meeting.status !== 'ready' || !meeting.audioUrl) {
    return NextResponse.json({ error: 'Clips can be made once the meeting is ready.' }, { status: 409 });
  }
  const range = selectionRange(parsed.data.startMs, parsed.data.endMs, meeting.durationSec === null ? null : meeting.durationSec * 1000);
  if ('error' in range) return NextResponse.json({ error: range.error }, { status: 400 });
  const [first] = await db
    .select({ text: utterances.text })
    .from(utterances)
    .where(and(eq(utterances.meetingId, id), gte(utterances.startMs, range.startMs), lt(utterances.startMs, range.endMs)))
    .orderBy(asc(utterances.startMs))
    .limit(1);
  const [clip] = await db
    .insert(clips)
    .values({ meetingId: id, origin: 'manual', ...range, title: first ? clipTitleFromText(first.text) : '', shareToken: newShareToken() })
    .returning({ id: clips.id });
  after(() => cutClip(clip.id));
  return NextResponse.json({ id: clip.id }, { status: 201 });
}
