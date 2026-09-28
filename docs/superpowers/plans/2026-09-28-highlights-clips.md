# Highlights and Shareable Clips — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mark moments during a call (bot or browser recording), see them land in the summary, transcript and player, clip any transcript range, and share a clip through a public page that exposes only that clip's audio.

**Architecture:**
- One `clips` table holds live highlights and manual clips.
- A live clip starts with only `mark_ms`. `summarizeMeeting` gives it a range (a window around the click, snapped to utterances), asks Claude for a label, and then cuts every clip that has a range.
- Cutting runs `ffmpeg-static` against the meeting's Blob URL and stores the result as its own Blob. The share page at `/c/[token]` reads only the clip's file and the utterances inside its range.

**Tech Stack:** Next.js 16.3 App Router, Drizzle 0.45 + Neon (neon-http), `@vercel/blob` 2.8 (`put`, `del`), `ffmpeg-static`, AI SDK 7 (`generateText` + `Output.object`), zod 4, vitest 5.

**Spec:** `docs/superpowers/specs/2026-09-28-highlights-clips-design.md`

## Global Constraints

- **Prerequisite:** the speakers/templates/titles/delete plan is merged on this branch. Its Task 6 (README, deploy) may be finished together with Task 7 here.
- Never modify or delete `.claude/`, `.agent-logs/` or `CAPTURE-TEST.md`. Never commit `.env*` or audio files.
- **Next 16:**
  - `params` are Promises.
  - Background work uses `after()` from `next/server`.
  - Check `node_modules/next/dist/docs/` before writing new route or config code (AGENTS.md).
  - The file-tracing config used in Task 3 comes from `01-app/03-api-reference/05-config/01-next-config-js/output.md`.
- There is no auth: anyone can create, delete or share clips.
- **Values, exactly:**
  - Live window: 30 000 ms before the mark, 5 000 ms after.
  - Snapping may widen either edge by at most 15 000 ms.
  - Max clip length: 300 000 ms (5 minutes).
  - Max clips per meeting: 50.
  - Cut timeout (stale): 3 minutes.
  - ffmpeg process timeout: 120 s.
  - Clip audio: MP3, 96k.
  - Share token: 16 random bytes as base64url, which is 22 characters.
  - Default manual title: the first utterance's text with whitespace collapsed, at most 60 characters (59 characters + `…` when cut).
- **Copy, exactly:**
  - Clip delete confirm: `Delete this clip? Its share link will stop working.`
  - Share page while not ready: `This clip is still being prepared.`
  - Live toast: `Highlighted at mm:ss`.
- The share page must never contain the meeting's `audio_url`, a link to the meeting, chat, or the site nav.
- Old summaries (without `highlights`) must keep rendering. Guard with `?? []`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work on branch `feat/speakers-templates`, or a new `feat/highlights-clips` branched from it.

## Review Focus

1. **A browser recording made with MediaRecorder** (WebM with no cue index) cut from the middle of a long file. Expected: the cut is correct even though ffmpeg has to read from the start. Pinned in Task 3 Step 7 (`check:clip` on a recorder WebM at 20 minutes, if one exists, else the longest WebM available).
2. **A live click during one long monologue utterance.** Expected: the clip doesn't grow to minutes. Pinned in Task 1 (`liveClipRange` long monologue test).
3. **Deleting a clip, or its meeting, while the clip is being cut.** Expected: no orphan Blob and no error. Pinned in Task 3 Step 8 (delete immediately after creating).
4. **Highlight pressed before the bot records, or after Stop.** Expected: `409` before recording starts; after Stop, the mark is clamped into the recording. Pinned in Task 1 (`botHighlightOffset` null, `liveClipRange` mark past the duration) and Task 7 Step 3.
5. **Claude returning a timestamp in a different shape** (`1:02` vs `01:02`) or an extra, unknown timestamp. Expected: labels still match by second, and unknown ones are ignored. Pinned in Task 1 (`labelsForClips` tests).

---

## File Structure

```
lib/clips/logic.ts             pure: liveClipRange, selectionRange, rangeFromLines, botHighlightOffset, clipTitleFromText,
                               labelsForClips, linesInClips, visibleClips, isShareToken, ClipItem, constants
lib/clips/token.ts             newShareToken (node:crypto; server only)
lib/clips/queries.ts           listClips, failStaleClips, countBusyClips
lib/clips/ffmpeg.ts            ffmpegCutArgs (pure), cutAudio (spawn ffmpeg-static)
lib/clips/cut.ts               cutClip, cutMeetingClips
lib/clips/place.ts             placeLiveClips, labelClips
lib/db/schema.ts               (modify) clip_status, clip_origin, clips
lib/summary-schema.ts          (modify) + highlights
lib/pipeline/prompts.ts        (modify) highlightInstructions
lib/pipeline/summarize.ts      (modify) third param highlightTimestamps
lib/pipeline/advance.ts        (modify) summarizeMeeting places, labels and cuts clips
lib/summary-markdown.ts        (modify) Highlights section
lib/client/media.ts            (modify) createMeeting accepts highlights
next.config.ts                 (modify) ffmpeg-static external + traced
app/api/meetings/route.ts                  (modify) highlights[] from the recorder
app/api/meetings/[id]/route.ts             (modify) GET busyClips; DELETE removes clip Blobs
app/api/meetings/[id]/clips/route.ts       POST live | manual
app/api/clips/[id]/route.ts                DELETE
app/api/clips/[id]/retry/route.ts          POST
app/(app)/layout.tsx           site nav moves here, so /c/* has no nav
app/(app)/page.tsx, app/(app)/new/, app/(app)/meetings/   (moved, unchanged)
app/c/[token]/page.tsx         public share page
components/clips-panel.tsx     clip list with copy/retry/delete
components/highlight-bar.tsx   markers under the player
components/transcript-view.tsx (modify) endMs, clip band, selection
components/summary-view.tsx    (modify) Highlights section
components/meeting-view.tsx    (modify) live Highlight button, clip-from-selection, clips, polling
components/recorder.tsx        (modify) Highlight button
scripts/check-clip.ts          local ffmpeg smoke test
tests/clips.test.ts, tests/clip-token.test.ts, tests/ffmpeg-args.test.ts, tests/clip-prompt.test.ts
```

---

## Task 1: Pure clip logic

**Files:**
- Create: `lib/clips/logic.ts`, `lib/clips/token.ts`
- Test: `tests/clips.test.ts`, `tests/clip-token.test.ts`

**Interfaces:**
- Consumes: `timestampToMs(label: string): number | null` from `lib/chat/citations.ts`
- Produces:
  - `MAX_CLIP_MS`, `LIVE_BEFORE_MS`, `LIVE_AFTER_MS`, `MAX_SNAP_MS`, `CLIP_CUT_TIMEOUT_MS`, `MAX_CLIPS_PER_MEETING`
  - `type ClipRange = { startMs: number; endMs: number }`
  - `type ClipItem = { id: string; origin: 'live' | 'manual'; markMs: number | null; startMs: number | null; endMs: number | null; title: string; status: 'pending' | 'cutting' | 'ready' | 'failed'; error: string | null; shareToken: string }`
  - `liveClipRange(markMs: number, utterances: { startMs: number; endMs: number }[], durationMs: number | null): ClipRange | null`
  - `selectionRange(startMs: number, endMs: number, durationMs: number | null): ClipRange | { error: string }`
  - `rangeFromLines(lines: { id: number; startMs: number; endMs: number }[], idA: number, idB: number): ClipRange | null`
  - `botHighlightOffset(now: Date, startedAt: Date | null): number | null`
  - `clipTitleFromText(text: string): string`
  - `labelsForClips(clips: { id: string; startMs: number }[], highlights: { timestamp: string; label: string }[]): Map<string, string>`
  - `linesInClips(lines: { id: number; startMs: number; endMs: number }[], ranges: ClipRange[]): Set<number>`
  - `visibleClips<T extends { startMs: number | null }>(clips: T[], meetingStatus: string): T[]`
  - `isShareToken(s: string): boolean`
  - `newShareToken(): string` (in `token.ts`)

- [ ] **Step 1: Write the failing tests** in `tests/clips.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import {
  botHighlightOffset,
  clipTitleFromText,
  isShareToken,
  labelsForClips,
  linesInClips,
  liveClipRange,
  rangeFromLines,
  selectionRange,
  visibleClips,
} from '../lib/clips/logic';

const utts = [
  { startMs: 0, endMs: 10_000 },
  { startMs: 10_000, endMs: 40_000 },
  { startMs: 40_000, endMs: 50_000 },
];

describe('liveClipRange', () => {
  it('snaps both edges to the utterances that contain them', () => {
    expect(liveClipRange(45_000, utts, 60_000)).toEqual({ startMs: 10_000, endMs: 50_000 });
  });
  it('clamps at 0 and does not snap an edge more than 15s', () => {
    // raw [0, 15000]; the end sits in 10000–40000, which would widen it by 25s
    expect(liveClipRange(10_000, utts, 60_000)).toEqual({ startMs: 0, endMs: 15_000 });
  });
  it('clamps at the duration', () => {
    expect(liveClipRange(58_000, [], 60_000)).toEqual({ startMs: 28_000, endMs: 60_000 });
  });
  it('clamps a mark past the end of the recording (clicked after Stop)', () => {
    expect(liveClipRange(70_000, [], 60_000)).toEqual({ startMs: 30_000, endMs: 60_000 });
  });
  it('keeps the raw window inside a silence gap', () => {
    expect(liveClipRange(40_000, [{ startMs: 0, endMs: 5_000 }, { startMs: 50_000, endMs: 60_000 }], 100_000)).toEqual({
      startMs: 10_000,
      endMs: 45_000,
    });
  });
  it('does not swallow a long monologue', () => {
    expect(liveClipRange(100_000, [{ startMs: 0, endMs: 120_000 }], 120_000)).toEqual({ startMs: 70_000, endMs: 120_000 });
  });
  it('returns null for an empty recording', () => {
    expect(liveClipRange(0, [], 0)).toBeNull();
  });
  it('works without a known duration', () => {
    expect(liveClipRange(1_000, [], null)).toEqual({ startMs: 0, endMs: 6_000 });
  });
});

describe('selectionRange', () => {
  it('accepts a valid range', () => {
    expect(selectionRange(1_000, 20_000, 60_000)).toEqual({ startMs: 1_000, endMs: 20_000 });
  });
  it('clamps the end to the duration', () => {
    expect(selectionRange(50_000, 60_400, 60_000)).toEqual({ startMs: 50_000, endMs: 60_000 });
  });
  it('rejects empty, reversed and negative ranges', () => {
    expect(selectionRange(5_000, 5_000, 60_000)).toHaveProperty('error');
    expect(selectionRange(6_000, 5_000, 60_000)).toHaveProperty('error');
    expect(selectionRange(-1, 5_000, 60_000)).toHaveProperty('error');
  });
  it('caps clips at 5 minutes', () => {
    expect(selectionRange(0, 300_000, null)).toEqual({ startMs: 0, endMs: 300_000 });
    expect(selectionRange(0, 300_001, null)).toEqual({ error: 'Clips can be at most 5 minutes long.' });
  });
});

describe('rangeFromLines', () => {
  const lines = [
    { id: 1, startMs: 0, endMs: 4_000 },
    { id: 2, startMs: 4_000, endMs: 9_000 },
    { id: 3, startMs: 9_000, endMs: 12_000 },
  ];
  it('spans from the earlier line start to the later line end, in either selection direction', () => {
    expect(rangeFromLines(lines, 1, 2)).toEqual({ startMs: 0, endMs: 9_000 });
    expect(rangeFromLines(lines, 3, 2)).toEqual({ startMs: 4_000, endMs: 12_000 });
  });
  it('returns null for unknown ids', () => {
    expect(rangeFromLines(lines, 1, 99)).toBeNull();
  });
});

describe('botHighlightOffset', () => {
  it('is null before the bot records', () => {
    expect(botHighlightOffset(new Date('2026-09-28T12:00:00Z'), null)).toBeNull();
  });
  it('is the time since recording started, never negative', () => {
    const start = new Date('2026-09-28T12:00:00Z');
    expect(botHighlightOffset(new Date('2026-09-28T12:01:30Z'), start)).toBe(90_000);
    expect(botHighlightOffset(new Date('2026-09-28T11:59:59Z'), start)).toBe(0);
  });
});

describe('clipTitleFromText', () => {
  it('collapses whitespace and keeps short text', () => {
    expect(clipTitleFromText('  We ship\n on Friday ')).toBe('We ship on Friday');
  });
  it('cuts long text to 60 characters with an ellipsis', () => {
    const t = clipTitleFromText('a'.repeat(100));
    expect(t).toHaveLength(60);
    expect(t.endsWith('…')).toBe(true);
  });
});

describe('labelsForClips', () => {
  const clips = [
    { id: 'a', startMs: 62_400 },
    { id: 'b', startMs: 600_000 },
  ];
  it('matches by second regardless of timestamp padding', () => {
    const m = labelsForClips(clips, [
      { timestamp: '1:02', label: 'Pricing pushback' },
      { timestamp: '10:00', label: '  Launch   date agreed ' },
    ]);
    expect(m.get('a')).toBe('Pricing pushback');
    expect(m.get('b')).toBe('Launch date agreed');
  });
  it('ignores unknown timestamps, malformed timestamps and blank labels', () => {
    const m = labelsForClips(clips, [
      { timestamp: '05:00', label: 'Nope' },
      { timestamp: 'soon', label: 'Nope' },
      { timestamp: '01:02', label: '   ' },
    ]);
    expect(m.size).toBe(0);
  });
  it('gives two clips in the same second one label each, in order', () => {
    const m = labelsForClips(
      [
        { id: 'x', startMs: 5_000 },
        { id: 'y', startMs: 5_500 },
      ],
      [
        { timestamp: '00:05', label: 'First' },
        { timestamp: '00:05', label: 'Second' },
      ],
    );
    expect([m.get('x'), m.get('y')]).toEqual(['First', 'Second']);
  });
});

describe('linesInClips', () => {
  it('marks lines that overlap any range', () => {
    const lines = [
      { id: 1, startMs: 0, endMs: 5_000 },
      { id: 2, startMs: 5_000, endMs: 10_000 },
      { id: 3, startMs: 10_000, endMs: 15_000 },
    ];
    expect(linesInClips(lines, [{ startMs: 6_000, endMs: 10_000 }])).toEqual(new Set([2]));
  });
});

describe('visibleClips', () => {
  const clips = [{ startMs: null }, { startMs: 1_000 }];
  it('shows unplaced live highlights only while the meeting is still processing', () => {
    expect(visibleClips(clips, 'in_meeting')).toHaveLength(2);
    expect(visibleClips(clips, 'summarizing')).toHaveLength(2);
    expect(visibleClips(clips, 'ready')).toEqual([{ startMs: 1_000 }]);
    expect(visibleClips(clips, 'failed')).toEqual([{ startMs: 1_000 }]);
  });
});

describe('isShareToken', () => {
  it('accepts 22 base64url characters only', () => {
    expect(isShareToken('abcdefghijklmnopqrstu_')).toBe(true);
    expect(isShareToken('abc')).toBe(false);
    expect(isShareToken('abcdefghijklmnopqrstu/')).toBe(false);
  });
});
```

And `tests/clip-token.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isShareToken } from '../lib/clips/logic';
import { newShareToken } from '../lib/clips/token';

describe('newShareToken', () => {
  it('makes distinct 22-character base64url tokens', () => {
    const a = newShareToken();
    const b = newShareToken();
    expect(isShareToken(a)).toBe(true);
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run them and check they fail**

Run: `npx vitest run tests/clips.test.ts tests/clip-token.test.ts`
Expected: FAIL, because `lib/clips/logic` can't be resolved.

- [ ] **Step 3: Implement `lib/clips/logic.ts`**

```ts
import { timestampToMs } from '../chat/citations';

export const MAX_CLIP_MS = 5 * 60 * 1000;
export const LIVE_BEFORE_MS = 30_000;
export const LIVE_AFTER_MS = 5_000;
// Snapping to whole utterances may widen an edge by at most this much, so one long monologue can't swallow minutes.
export const MAX_SNAP_MS = 15_000;
export const CLIP_CUT_TIMEOUT_MS = 3 * 60 * 1000;
export const MAX_CLIPS_PER_MEETING = 50;

export type ClipRange = { startMs: number; endMs: number };

export type ClipItem = {
  id: string;
  origin: 'live' | 'manual';
  markMs: number | null;
  startMs: number | null;
  endMs: number | null;
  title: string;
  status: 'pending' | 'cutting' | 'ready' | 'failed';
  error: string | null;
  shareToken: string;
};

type Span = { startMs: number; endMs: number };

// A live highlight is pressed just after the moment it's about, so the window reaches mostly backwards from the click.
export function liveClipRange(markMs: number, utterances: Span[], durationMs: number | null): ClipRange | null {
  const max = durationMs ?? Infinity;
  const mark = Math.min(Math.max(0, markMs), max);
  let start = Math.max(0, mark - LIVE_BEFORE_MS);
  let end = Math.min(max, mark + LIVE_AFTER_MS);
  const atStart = utterances.find((u) => u.startMs <= start && start < u.endMs);
  if (atStart && start - atStart.startMs <= MAX_SNAP_MS) start = atStart.startMs;
  const atEnd = utterances.find((u) => u.startMs < end && end <= u.endMs);
  if (atEnd && atEnd.endMs - end <= MAX_SNAP_MS) end = Math.min(max, atEnd.endMs);
  return end > start ? { startMs: start, endMs: end } : null;
}

export function selectionRange(startMs: number, endMs: number, durationMs: number | null): ClipRange | { error: string } {
  if (!Number.isInteger(startMs) || !Number.isInteger(endMs) || startMs < 0) return { error: 'Invalid clip range.' };
  // The last utterance can end a few hundred ms past the rounded duration, so the end is clamped rather than rejected.
  const end = durationMs === null ? endMs : Math.min(endMs, durationMs);
  if (end <= startMs) return { error: 'A clip must end after it starts.' };
  if (end - startMs > MAX_CLIP_MS) return { error: 'Clips can be at most 5 minutes long.' };
  return { startMs, endMs: end };
}

export function rangeFromLines(lines: { id: number; startMs: number; endMs: number }[], idA: number, idB: number): ClipRange | null {
  const a = lines.findIndex((l) => l.id === idA);
  const b = lines.findIndex((l) => l.id === idB);
  if (a === -1 || b === -1) return null;
  return { startMs: lines[Math.min(a, b)].startMs, endMs: lines[Math.max(a, b)].endMs };
}

export function botHighlightOffset(now: Date, startedAt: Date | null): number | null {
  if (!startedAt) return null;
  return Math.max(0, now.getTime() - startedAt.getTime());
}

export function clipTitleFromText(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= 60 ? t : `${t.slice(0, 59).trimEnd()}…`;
}

// Claude echoes back the clip-start timestamps it was given; match them to clips by whole second.
export function labelsForClips(
  clips: { id: string; startMs: number }[],
  highlights: { timestamp: string; label: string }[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const h of highlights) {
    const ms = timestampToMs(h.timestamp.trim());
    const label = h.label.replace(/\s+/g, ' ').trim().slice(0, 80);
    if (ms === null || !label) continue;
    const clip = clips.find((c) => !out.has(c.id) && Math.floor(c.startMs / 1000) * 1000 === ms);
    if (clip) out.set(clip.id, label);
  }
  return out;
}

export function linesInClips(lines: { id: number; startMs: number; endMs: number }[], ranges: ClipRange[]): Set<number> {
  const ids = new Set<number>();
  for (const l of lines) if (ranges.some((r) => l.startMs < r.endMs && l.endMs > r.startMs)) ids.add(l.id);
  return ids;
}

const PROCESSING = ['in_meeting', 'transcribing', 'summarizing'];

// A live highlight without a range after processing ended can never be placed (the meeting failed or had no audio).
export function visibleClips<T extends { startMs: number | null }>(clips: T[], meetingStatus: string): T[] {
  return clips.filter((c) => c.startMs !== null || PROCESSING.includes(meetingStatus));
}

export function isShareToken(s: string): boolean {
  return /^[A-Za-z0-9_-]{22}$/.test(s);
}
```

And `lib/clips/token.ts`:

```ts
import { randomBytes } from 'node:crypto';

// Independent of the clip id, so a share link reveals nothing that could reach other API routes.
export function newShareToken(): string {
  return randomBytes(16).toString('base64url');
}
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `npx vitest run tests/clips.test.ts tests/clip-token.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/clips/logic.ts lib/clips/token.ts tests/clips.test.ts tests/clip-token.test.ts
git commit -m "feat: pure clip ranges, labels and share tokens

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 2: Clips table and queries

**Files:**
- Modify: `lib/db/schema.ts`
- Create: `lib/clips/queries.ts`, `drizzle/0003_*.sql` (generated)

**Interfaces:**
- Consumes: `CLIP_CUT_TIMEOUT_MS`, `ClipItem` (Task 1)
- Produces:
  - `clips` table plus `Clip` type
  - `failStaleClips(meetingId: string): Promise<void>`
  - `listClips(meetingId: string): Promise<ClipItem[]>`
  - `countBusyClips(meetingId: string): Promise<number>`

- [ ] **Step 1: Add the table to `lib/db/schema.ts`**, below `utterances`

```ts
export const clipStatus = pgEnum('clip_status', ['pending', 'cutting', 'ready', 'failed']);
export const clipOrigin = pgEnum('clip_origin', ['live', 'manual']);

export const clips = pgTable(
  'clips',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    origin: clipOrigin('origin').notNull(),
    // Where a live highlight was clicked, in ms from the start of the recording.
    markMs: integer('mark_ms'),
    // Null until known: a live highlight gets its range once the transcript exists.
    startMs: integer('start_ms'),
    endMs: integer('end_ms'),
    title: text('title').notNull().default(''),
    status: clipStatus('status').notNull().default('pending'),
    error: text('error'),
    audioUrl: text('audio_url'),
    shareToken: text('share_token').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('clips_meeting_start_idx').on(t.meetingId, t.startMs)],
);

export type Clip = typeof clips.$inferSelect;
```

- [ ] **Step 2: Generate and inspect the migration**

Run: `npm run db:generate`
Expected: a new `drizzle/0003_<name>.sql` that contains:
- `CREATE TYPE "public"."clip_status"` and `CREATE TYPE "public"."clip_origin"`
- `CREATE TABLE "clips"`
- the `meeting_id` foreign key with `ON DELETE cascade`
- the unique constraint on `share_token`
- `clips_meeting_start_idx`

It must contain nothing that touches `meetings` or `utterances`.

- [ ] **Step 3: Apply it**

Run: `npm run db:migrate`
Expected: it succeeds. (This is the shared Neon database the app uses. The migration is additive only.)

- [ ] **Step 4: Write `lib/clips/queries.ts`**

```ts
import { and, asc, count, eq, inArray, isNotNull, lt, or } from 'drizzle-orm';
import { db } from '../db';
import { clips } from '../db/schema';
import { CLIP_CUT_TIMEOUT_MS, type ClipItem } from './logic';

// A function that died mid-cut (or before it started) would leave the clip busy forever; this frees it for Retry.
export async function failStaleClips(meetingId: string): Promise<void> {
  const cutoff = new Date(Date.now() - CLIP_CUT_TIMEOUT_MS);
  await db
    .update(clips)
    .set({ status: 'failed', error: 'Cutting the clip timed out.' })
    .where(
      and(
        eq(clips.meetingId, meetingId),
        lt(clips.updatedAt, cutoff),
        or(eq(clips.status, 'cutting'), and(eq(clips.status, 'pending'), isNotNull(clips.startMs))),
      ),
    );
}

export async function listClips(meetingId: string): Promise<ClipItem[]> {
  await failStaleClips(meetingId);
  return db
    .select({
      id: clips.id,
      origin: clips.origin,
      markMs: clips.markMs,
      startMs: clips.startMs,
      endMs: clips.endMs,
      title: clips.title,
      status: clips.status,
      error: clips.error,
      shareToken: clips.shareToken,
    })
    .from(clips)
    .where(eq(clips.meetingId, meetingId))
    .orderBy(asc(clips.createdAt));
}

// Clips the page is waiting on; unplaced live highlights are covered by the meeting's own polling.
export async function countBusyClips(meetingId: string): Promise<number> {
  const [{ n }] = await db
    .select({ n: count() })
    .from(clips)
    .where(and(eq(clips.meetingId, meetingId), inArray(clips.status, ['pending', 'cutting']), isNotNull(clips.startMs)));
  return n;
}
```

- [ ] **Step 5: Typecheck and test**

Run: `npx tsc --noEmit && npm test`
Expected: no errors, and all tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/db/schema.ts lib/clips/queries.ts drizzle/
git commit -m "feat: clips table with stale-cut recovery

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 3: Cutting audio and the clip API

**Files:**
- Modify: `package.json` (dependency), `next.config.ts`, `app/api/meetings/[id]/route.ts`
- Create:
  - `lib/clips/ffmpeg.ts`, `lib/clips/cut.ts`, `scripts/check-clip.ts`
  - `app/api/meetings/[id]/clips/route.ts`, `app/api/clips/[id]/route.ts`, `app/api/clips/[id]/retry/route.ts`
- Test: `tests/ffmpeg-args.test.ts`

**Interfaces:**
- Consumes:
  - `clips`, `countBusyClips`, `failStaleClips` (Task 2)
  - `selectionRange`, `botHighlightOffset`, `clipTitleFromText`, `MAX_CLIPS_PER_MEETING` (Task 1), `newShareToken` (Task 1)
  - `getBot` (`lib/bot/recall.ts`), `recordingStartedAt` (`lib/bot/outcome.ts`)
- Produces:
  - `ffmpegCutArgs(sourceUrl: string, startMs: number, endMs: number): string[]`
  - `cutAudio(sourceUrl: string, startMs: number, endMs: number): Promise<Buffer>`
  - `cutClip(id: string): Promise<void>`: claims `pending|failed` with a range → `cutting` → `ready|failed`
  - `cutMeetingClips(meetingId: string): Promise<void>`
  - `POST /api/meetings/:id/clips`:
    - `{origin:'live'}` → `201 {id, markMs}`
    - `{origin:'manual', startMs, endMs}` → `201 {id}`
    - errors: `400`, `404`, `409`, `502`
  - `DELETE /api/clips/:id` → `204` | `404`
  - `POST /api/clips/:id/retry` → `202` | `404` | `409`
  - `GET /api/meetings/:id` now also returns `busyClips: number`

- [ ] **Step 1: Install ffmpeg-static and check the binary**

```bash
npm install ffmpeg-static
node -e "const p=require('ffmpeg-static'); console.log(p); require('child_process').execFileSync(p,['-hide_banner','-protocols'],{stdio:['ignore','pipe','inherit']}).toString().includes('https') ? console.log('https ok') : process.exit(1)"
```

Expected:
- a path ending in `node_modules/ffmpeg-static/ffmpeg`
- `https ok`
- `ls node_modules/ffmpeg-static` shows `index.d.ts` (the package ships its types).

If the package doesn't ship types, add `declare module 'ffmpeg-static' { const path: string | null; export default path; }` in `types/ffmpeg-static.d.ts`.

- [ ] **Step 2: Write the failing test** `tests/ffmpeg-args.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { ffmpegCutArgs } from '../lib/clips/ffmpeg';

describe('ffmpegCutArgs', () => {
  it('seeks the input, limits the length and encodes 96k mp3 to stdout', () => {
    expect(ffmpegCutArgs('https://x.blob.vercel-storage.com/a.mp3', 61_500, 96_500)).toEqual([
      '-hide_banner', '-loglevel', 'error',
      '-ss', '61.500', '-i', 'https://x.blob.vercel-storage.com/a.mp3',
      '-t', '35.000',
      '-vn', '-c:a', 'libmp3lame', '-b:a', '96k', '-f', 'mp3', 'pipe:1',
    ]);
  });
});
```

Run: `npx vitest run tests/ffmpeg-args.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `lib/clips/ffmpeg.ts`**

```ts
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

const CUT_TIMEOUT_MS = 120_000;

// -ss before -i seeks the input, so ffmpeg fetches only the ranges it needs over HTTP instead of the whole recording.
export function ffmpegCutArgs(sourceUrl: string, startMs: number, endMs: number): string[] {
  return [
    '-hide_banner', '-loglevel', 'error',
    '-ss', (startMs / 1000).toFixed(3), '-i', sourceUrl,
    '-t', ((endMs - startMs) / 1000).toFixed(3),
    '-vn', '-c:a', 'libmp3lame', '-b:a', '96k', '-f', 'mp3', 'pipe:1',
  ];
}

export function cutAudio(sourceUrl: string, startMs: number, endMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('ffmpeg is not available on this platform'));
    const proc = spawn(ffmpegPath, ffmpegCutArgs(sourceUrl, startMs, endMs), { stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    let stderr = '';
    const timer = setTimeout(() => proc.kill('SIGKILL'), CUT_TIMEOUT_MS);
    proc.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-500);
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', (code, signal) => {
      clearTimeout(timer);
      const audio = Buffer.concat(out);
      if (code === 0 && audio.length > 0) return resolve(audio);
      reject(new Error(signal ? 'ffmpeg timed out' : `ffmpeg failed (${code}): ${stderr.trim() || 'no output'}`));
    });
  });
}
```

Run: `npx vitest run tests/ffmpeg-args.test.ts`
Expected: PASS.

- [ ] **Step 4: Local smoke script `scripts/check-clip.ts`**, plus `"check:clip": "tsx scripts/check-clip.ts"` in `package.json` scripts

```ts
import { writeFileSync } from 'node:fs';
import { cutAudio } from '../lib/clips/ffmpeg';

// Usage: npm run check:clip -- <audio url> <startMs> <endMs> <out.mp3>
const [url, start, end, out] = process.argv.slice(2);
if (!url || !start || !end || !out) {
  console.error('usage: check:clip <audio url> <startMs> <endMs> <out.mp3>');
  process.exit(1);
}
const t0 = Date.now();
const audio = await cutAudio(url, Number(start), Number(end));
writeFileSync(out, audio);
console.log(`wrote ${audio.length} bytes in ${Date.now() - t0}ms to ${out}`);
```

- [ ] **Step 5: Trace the binary into functions, in `next.config.ts`.** First re-read `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md` (the `outputFileTracingIncludes` section) and `serverExternalPackages.md`.

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ffmpeg-static finds its binary by path at runtime: keep the package unbundled and ship the binary with every API function
  // (cuts run in after() from the poll, webhook, retry and clip routes).
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: {
    "/api/**/*": ["./node_modules/ffmpeg-static/ffmpeg"],
  },
};

export default nextConfig;
```

- [ ] **Step 6: Write `lib/clips/cut.ts`**

```ts
import { del, put } from '@vercel/blob';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { db } from '../db';
import { clips, meetings } from '../db/schema';
import { cutAudio } from './ffmpeg';

export async function cutClip(id: string): Promise<void> {
  // Only one caller wins the claim, so a retry click racing an automatic cut never cuts twice.
  const [claimed] = await db
    .update(clips)
    .set({ status: 'cutting', error: null })
    .where(and(eq(clips.id, id), inArray(clips.status, ['pending', 'failed']), isNotNull(clips.startMs), isNotNull(clips.endMs)))
    .returning({ meetingId: clips.meetingId, startMs: clips.startMs, endMs: clips.endMs });
  if (!claimed) return;
  const cutting = and(eq(clips.id, id), eq(clips.status, 'cutting'));
  try {
    const [meeting] = await db.select({ audioUrl: meetings.audioUrl }).from(meetings).where(eq(meetings.id, claimed.meetingId));
    if (!meeting?.audioUrl) throw new Error('the meeting has no recording');
    const audio = await cutAudio(meeting.audioUrl, claimed.startMs!, claimed.endMs!);
    const blob = await put(`clips/${id}.mp3`, audio, { access: 'public', contentType: 'audio/mpeg', addRandomSuffix: true });
    const saved = await db.update(clips).set({ status: 'ready', audioUrl: blob.url }).where(cutting).returning({ id: clips.id });
    // The clip (or its meeting) was deleted while cutting: don't leave an orphaned file behind.
    if (saved.length === 0) await del(blob.url).catch((err) => console.error('Blob delete of orphan clip failed', id, err));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(clips).set({ status: 'failed', error: `Could not cut the clip: ${message}` }).where(cutting);
  }
}

// Every clip that has a range but no audio yet; failed ones are retried too.
export async function cutMeetingClips(meetingId: string): Promise<void> {
  const rows = await db
    .select({ id: clips.id })
    .from(clips)
    .where(and(eq(clips.meetingId, meetingId), inArray(clips.status, ['pending', 'failed']), isNotNull(clips.startMs)));
  for (const r of rows) await cutClip(r.id);
}
```

- [ ] **Step 7: Smoke-test ffmpeg on real Blob audio.** Get an existing meeting's audio URL:

```bash
npx tsx --env-file=.env.local -e "import('./lib/db/index.ts').then(async ({db}) => { const {meetings} = await import('./lib/db/schema.ts'); console.log(await db.select({id: meetings.id, src: meetings.source, url: meetings.audioUrl, d: meetings.durationSec}).from(meetings)); })"
```

Then cut from the middle of one MP3 and one recorder WebM (`src: 'record'`), preferring the longest one available:

```bash
npm run check:clip -- <mp3 url> 60000 95000 "$TMPDIR/clip-mp3.mp3"
npm run check:clip -- <webm url> 1200000 1235000 "$TMPDIR/clip-webm.mp3"   # use ~half its duration if it's shorter than 20 min
```

(`$TMPDIR` means your scratchpad directory.)

Expected:
- Both print `wrote N bytes`, with N around 35 s × 12 kB/s ≈ 420 000.
- `ffprobe`, or opening the file, shows about 35 s of the right audio.
- Note how long the WebM cut took. If it's over 60 s for a 1-hour file, record it in the README trade-offs in Task 7.

- [ ] **Step 8: Write `app/api/meetings/[id]/clips/route.ts`**

```ts
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
```

- [ ] **Step 9: Write `app/api/clips/[id]/route.ts` and `app/api/clips/[id]/retry/route.ts`**

```ts
// app/api/clips/[id]/route.ts
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
```

```ts
// app/api/clips/[id]/retry/route.ts
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
```

- [ ] **Step 10: Update `app/api/meetings/[id]/route.ts`**
- **GET:** after the meeting is found, add
  ```ts
  await failStaleClips(id);
  const busyClips = await countBusyClips(id);
  ```
  and return `{ ...meeting, busyClips }`. Import both from `@/lib/clips/queries`.
- **DELETE:** replace the `if (meeting.audioUrl) { await del(...) }` block with:

```ts
  const clipFiles = await db
    .select({ audioUrl: clips.audioUrl })
    .from(clips)
    .where(and(eq(clips.meetingId, id), isNotNull(clips.audioUrl)));
  const files = [meeting.audioUrl, ...clipFiles.map((c) => c.audioUrl)].filter((u): u is string => u !== null);
  if (files.length > 0) {
    await del(files).catch((err) => console.error('Blob delete failed', id, err));
  }
```

(Imports: `and`, `isNotNull` from `drizzle-orm`; `clips` from `@/lib/db/schema`.) Update the cascade comment to say that utterances and clips both go with the row.

- [ ] **Step 11: Check it live (local).** Run `npm run dev`, pick a `ready` meeting ID `M` from Step 7, then:

```bash
curl -s -X POST localhost:3000/api/meetings/M/clips -H 'content-type: application/json' -d '{"origin":"manual","startMs":5000,"endMs":20000}'
# → 201 {"id":"C"}
sleep 15; curl -s localhost:3000/api/meetings/M | grep -o '"busyClips":[0-9]*'   # → "busyClips":0
curl -s -X POST localhost:3000/api/meetings/M/clips -H 'content-type: application/json' -d '{"origin":"manual","startMs":0,"endMs":400000}'   # → 400 5-minute error
curl -s -X POST localhost:3000/api/meetings/M/clips -H 'content-type: application/json' -d '{"origin":"live"}'   # → 409 (not in_meeting)
curl -s -X POST localhost:3000/api/clips/C/retry -o /dev/null -w '%{http_code}\n'    # → 409 (ready, not failed)
```

Read clip `C` with the tsx snippet from Step 7 (select from `clips`). Expected:
- `status: 'ready'`
- an `audio_url` under `clips/`
- a title taken from the first utterance.

Open the URL: it plays 15 s.

Then check deleting during a cut (Review Focus 3):
- Create another manual clip and immediately `curl -X DELETE localhost:3000/api/clips/<new id>` → `204`.
- After 15 s, check the dev server log. It shows either nothing or the orphan-delete message, and no unhandled error.

Finally, `curl -X DELETE localhost:3000/api/clips/C` → `204`. Its `audio_url` now returns 404.

- [ ] **Step 12: Verify and commit**

```bash
npm test && npx tsc --noEmit && npx eslint .
git add package.json package-lock.json next.config.ts lib/clips/ffmpeg.ts lib/clips/cut.ts scripts/check-clip.ts tests/ffmpeg-args.test.ts \
  "app/api/meetings/[id]/clips/route.ts" "app/api/clips" "app/api/meetings/[id]/route.ts"
git commit -m "feat: cut clips to their own audio with ffmpeg; clip create, delete and retry API

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 4: Live highlights land in the pipeline

**Files:**
- Modify:
  - `lib/summary-schema.ts`, `lib/pipeline/prompts.ts`, `lib/pipeline/summarize.ts`, `lib/pipeline/advance.ts`
  - `lib/summary-markdown.ts`, `app/api/meetings/route.ts`, `lib/client/media.ts`
- Create: `lib/clips/place.ts`
- Test: `tests/clip-prompt.test.ts`, `tests/summary-markdown.test.ts` (modify)

**Interfaces:**
- Consumes: `liveClipRange`, `labelsForClips`, `MAX_CLIPS_PER_MEETING` (Task 1); `newShareToken` (Task 1); `cutMeetingClips` (Task 3)
- Produces:
  - `Summary.highlights: { timestamp: string; label: string }[]`
  - `highlightInstructions(timestamps: string[]): string`
  - `summarize(transcript, template = 'general', highlightTimestamps: string[] = [])`
  - `placeLiveClips(meetingId: string, utterances: { startMs: number; endMs: number }[], durationSec: number | null): Promise<{ id: string; startMs: number }[]>`
  - `labelClips(placed: { id: string; startMs: number }[], highlights: Summary['highlights']): Promise<void>`
  - `POST /api/meetings` accepts `highlights?: number[]`
  - `createMeeting({ …, highlights?: number[] })`

- [ ] **Step 1: Write the failing tests**

`tests/clip-prompt.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { highlightInstructions } from '../lib/pipeline/prompts';

describe('highlightInstructions', () => {
  it('asks for an empty list when nothing was highlighted', () => {
    expect(highlightInstructions([])).toBe('No moments were highlighted, so return an empty highlights list.');
  });
  it('lists the timestamps and asks for one label each', () => {
    const text = highlightInstructions(['01:02', '1:10:00']);
    expect(text).toContain('01:02, 1:10:00');
    expect(text).toContain('copied exactly');
    expect(text).toContain('at most 8 words');
  });
});
```

In `tests/summary-markdown.test.ts`:
- add `highlights: [],` to both existing summary objects
- add:

```ts
  it('puts highlights right after the overview', () => {
    const md = summaryToMarkdown('Sync', {
      title: '',
      overview: 'Short sync.',
      keyPoints: [],
      decisions: [],
      actionItems: [],
      keyMoments: [],
      sections: [],
      highlights: [{ timestamp: '01:02', label: 'Pricing pushback' }],
    });
    expect(md).toBe('# Sync\n\nShort sync.\n\n## Highlights\n- [01:02] Pricing pushback\n');
  });
```

Run: `npx vitest run tests/clip-prompt.test.ts tests/summary-markdown.test.ts`
Expected: FAIL. `highlightInstructions` isn't exported, and the Highlights section is missing.

- [ ] **Step 2: Summary schema.** In `lib/summary-schema.ts`, add after `sections`:

```ts
  highlights: z
    .array(
      z.object({
        timestamp: z.string().describe('A highlighted timestamp, copied exactly from the instructions'),
        label: z.string().describe('What is discussed in that moment, at most 8 words'),
      }),
    )
    .describe('One entry per highlighted moment listed in the instructions; empty if none are listed'),
```

and `highlights: [],` in `EMPTY_SUMMARY`.

- [ ] **Step 3: Prompt and summarize.** Add to `lib/pipeline/prompts.ts`:

```ts
export function highlightInstructions(timestamps: string[]): string {
  if (timestamps.length === 0) return 'No moments were highlighted, so return an empty highlights list.';
  return `During the call the user highlighted the moments starting at these timestamps: ${timestamps.join(', ')}.
For each one, add an entry to highlights with the timestamp copied exactly and a label of at most 8 words saying what is discussed in the half minute that starts there.`;
}
```

In `lib/pipeline/summarize.ts`, change the signature to `summarize(transcript: string, template: MeetingTemplate = 'general', highlightTimestamps: string[] = [])` and the instructions to:

```ts
        instructions: `${SUMMARY_INSTRUCTIONS}\n\n${templateInstructions(template)}\n\n${highlightInstructions(highlightTimestamps)}`,
```

(Import `highlightInstructions` from `./prompts`.)

- [ ] **Step 4: Markdown.** In `lib/summary-markdown.ts`, right after `const section = …` is defined and before the Action items call, add:

```ts
  section('Highlights', (s.highlights ?? []).map((h) => `- [${h.timestamp}] ${h.label}`));
```

Run: `npx vitest run tests/clip-prompt.test.ts tests/summary-markdown.test.ts`
Expected: PASS.

- [ ] **Step 5: Write `lib/clips/place.ts`**

```ts
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db';
import { clips } from '../db/schema';
import type { Summary } from '../summary-schema';
import { labelsForClips, liveClipRange } from './logic';

// Live highlights get their range once the transcript exists. Clips already placed (e.g. on a re-summary) are returned as they are.
export async function placeLiveClips(
  meetingId: string,
  utterances: { startMs: number; endMs: number }[],
  durationSec: number | null,
): Promise<{ id: string; startMs: number }[]> {
  const live = await db
    .select({ id: clips.id, markMs: clips.markMs, startMs: clips.startMs })
    .from(clips)
    .where(and(eq(clips.meetingId, meetingId), eq(clips.origin, 'live')));
  const durationMs = durationSec === null ? null : durationSec * 1000;
  const placed: { id: string; startMs: number }[] = [];
  for (const c of live) {
    if (c.startMs !== null) {
      placed.push({ id: c.id, startMs: c.startMs });
      continue;
    }
    const range = c.markMs === null ? null : liveClipRange(c.markMs, utterances, durationMs);
    if (!range) {
      await db.update(clips).set({ status: 'failed', error: 'The recording is too short to clip.' }).where(eq(clips.id, c.id));
      continue;
    }
    await db.update(clips).set(range).where(and(eq(clips.id, c.id), isNull(clips.startMs)));
    placed.push({ id: c.id, startMs: range.startMs });
  }
  return placed;
}

// A title the user already has (or an earlier label) is never overwritten.
export async function labelClips(placed: { id: string; startMs: number }[], highlights: Summary['highlights']): Promise<void> {
  for (const [id, label] of labelsForClips(placed, highlights)) {
    await db.update(clips).set({ title: label }).where(and(eq(clips.id, id), eq(clips.title, '')));
  }
}
```

- [ ] **Step 6: Wire it into `summarizeMeeting`** in `lib/pipeline/advance.ts`. Replace the function with:

```ts
export async function summarizeMeeting(id: string): Promise<void> {
  const meeting = await db.query.meetings.findFirst({
    where: eq(meetings.id, id),
    columns: { speakerNames: true, template: true, titleIsAuto: true, durationSec: true },
  });
  if (!meeting) return;
  const lines = await db
    .select({ speaker: utterances.speaker, startMs: utterances.startMs, endMs: utterances.endMs, text: utterances.text })
    .from(utterances)
    .where(eq(utterances.meetingId, id))
    .orderBy(asc(utterances.startMs));
  // Placed here rather than in advanceMeeting so a retry or re-summary also places highlights a failed run never reached.
  const placed = await placeLiveClips(id, lines, meeting.durationSec);
  try {
    const summary =
      lines.length === 0
        ? EMPTY_SUMMARY
        : await summarize(
            formatTranscript(lines, meeting.speakerNames),
            meeting.template,
            placed.map((c) => formatTimestamp(c.startMs)),
          );
    await db.update(meetings).set({ status: 'ready', summary, error: null }).where(eq(meetings.id, id));
    const autoTitle = pickAutoTitle(meeting.titleIsAuto, summary.title);
    if (autoTitle) {
      await db.update(meetings).set({ title: autoTitle }).where(and(eq(meetings.id, id), eq(meetings.titleIsAuto, true)));
    }
    await labelClips(placed, summary.highlights ?? []);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(meetings).set({ status: 'failed', error: `Summary failed: ${message}` }).where(eq(meetings.id, id));
  }
  // Clips don't depend on the summary, so they're cut even when it failed.
  await cutMeetingClips(id);
}
```

(Imports: `formatTimestamp` from `../transcript/format`, `placeLiveClips` and `labelClips` from `../clips/place`, `cutMeetingClips` from `../clips/cut`.)

- [ ] **Step 7: Recorder highlights on create.** In `app/api/meetings/route.ts`, add to `createSchema`:

```ts
  highlights: z.array(z.number().int().nonnegative().max(MAX_DURATION_SEC * 1000)).max(MAX_CLIPS_PER_MEETING).default([]),
```

and change the insert to:

```ts
  const { highlights, ...values } = parsed.data;
  const [meeting] = await db
    .insert(meetings)
    .values({ ...values, ...resolveCreateTitle(values.title), assemblyaiId })
    .returning({ id: meetings.id });
  // Marks past the end of the recording are clamped when the clip is placed.
  if (highlights.length > 0) {
    await db.insert(clips).values(highlights.map((markMs) => ({ meetingId: meeting.id, origin: 'live' as const, markMs, shareToken: newShareToken() })));
  }
```

(Imports: `clips` from `@/lib/db/schema`, `MAX_CLIPS_PER_MEETING` from `@/lib/clips/logic`, `newShareToken` from `@/lib/clips/token`.)

In `lib/client/media.ts`, add `highlights?: number[];` to the `createMeeting` input type.

- [ ] **Step 8: Check it live (local).** With `npm run dev` running, reuse the audio URL `U` of an existing short `ready` upload (any duration `D` over 60 s):

```bash
curl -s -X POST localhost:3000/api/meetings -H 'content-type: application/json' \
  -d '{"title":"","audioUrl":"U","durationSec":D,"source":"record","highlights":[20000,50000]}'
```

Open `/meetings/<new id>` and wait until it's `ready`. Then read its clips (the tsx snippet from Task 3 Step 7, selecting from `clips` where `meeting_id` is the new ID). Expected:
- two `live` clips, each with a range around 20 s and 50 s
- both have non-empty Claude titles
- both are `ready`
- the stored `summary.highlights` has two entries.

**Clean up** without using the app's DELETE, because it would also delete `U`, which the original meeting still uses:

```bash
npx tsx --env-file=.env.local -e "import('./lib/db/index.ts').then(async ({db}) => { const {meetings} = await import('./lib/db/schema.ts'); const {eq} = await import('drizzle-orm'); await db.delete(meetings).where(eq(meetings.id, '<new id>')); })"
```

(The two clip MP3s are left in Blob. That's acceptable for a test.)

- [ ] **Step 9: Verify and commit**

```bash
npm test && npx tsc --noEmit && npx eslint .
git add lib/summary-schema.ts lib/pipeline/prompts.ts lib/pipeline/summarize.ts lib/pipeline/advance.ts lib/summary-markdown.ts \
  lib/clips/place.ts app/api/meetings/route.ts lib/client/media.ts tests/clip-prompt.test.ts tests/summary-markdown.test.ts
git commit -m "feat: live highlights get a range, a Claude label and a cut once the transcript exists

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 5: Meeting page and recorder UI

**Files:**
- Modify:
  - `app/meetings/[id]/page.tsx`
  - `components/meeting-view.tsx`, `components/transcript-view.tsx`, `components/summary-view.tsx`, `components/recorder.tsx`
- Create: `components/clips-panel.tsx`, `components/highlight-bar.tsx`

**Interfaces:**
- Consumes:
  - `listClips`, `ClipItem`, `visibleClips`, `linesInClips`, `rangeFromLines`, `MAX_CLIPS_PER_MEETING`
  - `POST /api/meetings/:id/clips`, `DELETE /api/clips/:id`, `POST /api/clips/:id/retry`
  - `GET /api/meetings/:id` → `busyClips`
- Produces: the UI only.

- [ ] **Step 1: Page data.** In `app/meetings/[id]/page.tsx`:
- add `endMs: utterances.endMs` to the lines select
- load `const clipList = await listClips(id);` (from `@/lib/clips/queries`)
- pass `clips={clipList}` to `MeetingView`.

- [ ] **Step 2: `components/transcript-view.tsx`.**
- `Line` becomes `{ id: number; speaker: string; startMs: number; endMs: number; text: string }`.
- Add props `clipLineIds: Set<number>` and `onSelectRange: (range: ClipRange | null) => void`.
- Each `<li>` gets `data-line-id={l.id}`, and its className adds `border-l-4 border-amber-400 pl-3` when `clipLineIds.has(l.id)`.
- The `<ol>` gets `onMouseUp={() => onSelectRange(selectedRange())}` and `onKeyUp={() => onSelectRange(selectedRange())}`, where `selectedRange` is defined inside the component:

```tsx
  function selectedRange(): ClipRange | null {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return null;
    const lineId = (node: Node | null) => {
      const el = node instanceof Element ? node : node?.parentElement;
      const li = el?.closest('li[data-line-id]');
      return li ? Number(li.getAttribute('data-line-id')) : null;
    };
    const a = lineId(sel.anchorNode);
    const b = lineId(sel.focusNode);
    return a === null || b === null ? null : rangeFromLines(lines, a, b);
  }
```

(Imports: `type ClipRange`, `rangeFromLines` from `@/lib/clips/logic`.)

- [ ] **Step 3: `components/highlight-bar.tsx`**

```tsx
'use client';

import type { ClipRange } from '@/lib/clips/logic';
import { formatTimestamp } from '@/lib/transcript/format';

type Marker = ClipRange & { id: string; title: string };

export function HighlightBar({ clips, durationMs, onSeek }: { clips: Marker[]; durationMs: number | null; onSeek: (ms: number) => void }) {
  if (!durationMs || clips.length === 0) return null;
  const pct = (ms: number) => Math.min(100, (ms / durationMs) * 100);
  return (
    <div className="relative mt-1 h-2 w-full rounded bg-muted" aria-label="Highlights and clips">
      {clips.map((c) => (
        <button
          key={c.id}
          type="button"
          title={`${c.title || 'Clip'} · ${formatTimestamp(c.startMs)}`}
          aria-label={`Play ${c.title || 'clip'} at ${formatTimestamp(c.startMs)}`}
          onClick={() => onSeek(c.startMs)}
          className="absolute top-0 h-2 rounded bg-amber-400 hover:bg-amber-500"
          style={{ left: `${pct(c.startMs)}%`, width: `max(4px, ${pct(c.endMs - c.startMs)}%)` }}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: `components/clips-panel.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ClipItem } from '@/lib/clips/logic';
import { formatTimestamp } from '@/lib/transcript/format';

type Props = { clips: ClipItem[]; onSeek: (ms: number) => void; onChanged: () => void; onError: (message: string | null) => void };

function clipName(c: ClipItem): string {
  if (c.title) return c.title;
  return c.origin === 'live' && c.markMs !== null ? `Highlight at ${formatTimestamp(c.markMs)}` : 'Clip';
}

function statusText(c: ClipItem): string | null {
  if (c.startMs === null) return 'Lands after processing';
  if (c.status === 'pending' || c.status === 'cutting') return 'Preparing…';
  if (c.status === 'failed') return c.error ?? 'Failed';
  return null;
}

export function ClipsPanel({ clips, onSeek, onChanged, onError }: Props) {
  const [copied, setCopied] = useState<string | null>(null);
  if (clips.length === 0) {
    return <p className="text-sm text-muted-foreground">No clips yet. Select lines in the transcript to make one.</p>;
  }

  async function act(res: Promise<Response>, fallback: string) {
    onError(null);
    const r = await res;
    if (!r.ok) {
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      onError(data.error ?? fallback);
    }
    onChanged();
  }

  async function copyLink(c: ClipItem) {
    await navigator.clipboard.writeText(`${window.location.origin}/c/${c.shareToken}`);
    setCopied(c.id);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <ul className="space-y-2 text-sm">
      {clips.map((c) => (
        <li key={c.id} className="space-y-1 rounded border p-2">
          <div className="flex items-center gap-2">
            {c.startMs !== null ? (
              <button type="button" onClick={() => onSeek(c.startMs!)} className="font-mono text-xs text-muted-foreground hover:underline">
                {formatTimestamp(c.startMs)}–{formatTimestamp(c.endMs ?? c.startMs)}
              </button>
            ) : null}
            <span className="font-medium">{clipName(c)}</span>
            {c.origin === 'live' && <Badge variant="secondary">Highlight</Badge>}
          </div>
          {statusText(c) && <p className={c.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}>{statusText(c)}</p>}
          <div className="flex gap-2">
            {c.status === 'ready' && (
              <Button size="sm" variant="outline" onClick={() => copyLink(c)}>
                {copied === c.id ? 'Copied' : 'Copy link'}
              </Button>
            )}
            {c.status === 'failed' && c.startMs !== null && (
              <Button size="sm" variant="outline" onClick={() => act(fetch(`/api/clips/${c.id}/retry`, { method: 'POST' }), 'Could not retry the clip.')}>
                Retry
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (!window.confirm('Delete this clip? Its share link will stop working.')) return;
                void act(fetch(`/api/clips/${c.id}`, { method: 'DELETE' }), 'Could not delete the clip.');
              }}
            >
              Delete
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 5: Summary Highlights section.** In `components/summary-view.tsx`, extract the Key moments `<ul>` into a local component so both sections share it:

```tsx
function TimestampList({ items, onSeek }: { items: { timestamp: string; label: string }[]; onSeek: (ms: number) => void }) {
  return (
    <ul className="space-y-1">
      {items.map((k, i) => {
        const ms = timestampToMs(k.timestamp);
        return (
          <li key={i}>
            {ms !== null ? (
              <button type="button" onClick={() => onSeek(ms)} className="mr-2 font-mono text-xs text-muted-foreground hover:underline">{k.timestamp}</button>
            ) : null}
            {k.label}
          </li>
        );
      })}
    </ul>
  );
}
```

Render `<Section title="Highlights"><TimestampList items={summary.highlights ?? []} onSeek={onSeek} /></Section>` right after the overview `<p>`, only when the list is non-empty. Key moments uses `<TimestampList items={summary.keyMoments ?? []} …/>`.

- [ ] **Step 6: `components/meeting-view.tsx`.**
- Add `clips: ClipItem[]` to `MeetingViewProps`.
- **Polling:** change `useStatusPolling` to take `busyClips: number` and:
  - run when `POLLED.includes(status) || busyClips > 0`
  - refresh when `data.busyClips !== busyClips`
  - add `busyClips` to the response type and to the effect's dependencies.
  Call it with:
  ```ts
  props.clips.filter((c) => c.startMs !== null && (c.status === 'pending' || c.status === 'cutting')).length
  ```
- **Derived values:**

```ts
  const shownClips = useMemo(() => visibleClips(clips, meeting.status), [clips, meeting.status]);
  const placed = useMemo(
    () => shownClips.flatMap((c) => (c.startMs !== null && c.endMs !== null ? [{ id: c.id, title: c.title, startMs: c.startMs, endMs: c.endMs }] : [])),
    [shownClips],
  );
  const clipLineIds = useMemo(() => linesInClips(lines, placed), [lines, placed]);
```

- **Live highlight:** in the in-progress box, next to Stop, when `meeting.status === 'in_meeting' && meeting.botStatus === BOT_TEXT.recording`:

```tsx
  const [highlightMsg, setHighlightMsg] = useState<string | null>(null);
  async function highlight() {
    setHighlightMsg(null);
    const res = await fetch(`/api/meetings/${meeting.id}/clips`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ origin: 'live' }),
    });
    const data = (await res.json().catch(() => ({}))) as { markMs?: number; error?: string };
    setHighlightMsg(res.ok && data.markMs !== undefined ? `Highlighted at ${formatTimestamp(data.markMs)}` : (data.error ?? 'Could not add the highlight.'));
    if (res.ok) router.refresh();
  }
```

  Show it as `<Button size="sm" onClick={highlight}>Highlight</Button>`, with `{highlightMsg && <p className="text-sm text-muted-foreground">{highlightMsg}</p>}` below.
- **Clip from selection:**

```tsx
  const [selection, setSelection] = useState<ClipRange | null>(null);
  const [clipping, setClipping] = useState(false);
  async function clipSelection() {
    if (!selection) return;
    setClipping(true);
    setActionError(null);
    const res = await fetch(`/api/meetings/${meeting.id}/clips`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ origin: 'manual', ...selection }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setActionError(data.error ?? 'Could not create the clip.');
    }
    window.getSelection()?.removeAllRanges();
    setSelection(null);
    setClipping(false);
    router.refresh();
  }
```

  Under the Transcript `<h2>`, when `meeting.status === 'ready' && selection`, render a sticky bar:
  ```tsx
  <div className="sticky top-0 z-10 flex items-center gap-2 bg-background py-1">
    <Button size="sm" onClick={clipSelection} disabled={clipping}>
      Clip {formatTimestamp(selection.startMs)}–{formatTimestamp(selection.endMs)}
    </Button>
  </div>
  ```
- **Wiring:** pass `clipLineIds` and `onSelectRange={setSelection}` to `TranscriptView`.
- **Player:** render `<HighlightBar clips={placed} durationMs={meeting.durationSec === null ? null : meeting.durationSec * 1000} onSeek={seek} />` right under the `<audio>` inside the sticky player div.
- **Clips list:** in the Summary column, after the summary, add:

```tsx
          <h2 className="pt-4 text-lg font-semibold">Clips</h2>
          <ClipsPanel clips={shownClips} onSeek={seek} onChanged={() => router.refresh()} onError={setActionError} />
```

- [ ] **Step 7: Recorder Highlight button (`components/recorder.tsx`).**
- Add `highlights: number[]` to the `Pending` type.
- Add `const highlights = useRef<number[]>([]);` and `const [highlightCount, setHighlightCount] = useState(0);`.
- In `start()`, before `setPhase('recording')`: `highlights.current = []; setHighlightCount(0);`.
- In `stop()`: `const recording = { blob, durationSec, url: null, downloadUrl: URL.createObjectURL(blob), highlights: [...highlights.current] };`.
- In `submit()`, pass `highlights: recording.highlights` to `createMeeting`.
- In the recording phase, next to Stop:

```tsx
          <Button
            variant="outline"
            disabled={highlightCount >= MAX_CLIPS_PER_MEETING}
            onClick={() => {
              const s = session.current;
              if (!s) return;
              highlights.current.push(Date.now() - s.startedAt);
              setHighlightCount(highlights.current.length);
            }}
          >
            Highlight{highlightCount > 0 ? ` (${highlightCount})` : ''}
          </Button>
```

  (Import `MAX_CLIPS_PER_MEETING` from `@/lib/clips/logic`.)

- [ ] **Step 8: Browser check (local, `npm run dev`).**
  1. **Recorder:** record about 90 s from `/new` → Record. Press Highlight at about 40 s and about 70 s, then stop. On the meeting page, once it's ready:
     - the Summary shows a **Highlights** section with two labeled timestamps
     - two amber markers sit under the player, and clicking one seeks there
     - the transcript lines in those ranges have an amber left border
     - the Clips list shows both with Copy link once ready. Refreshing isn't needed, because the page polls while clips are busy.
  2. **Manual clip:** drag-select across three transcript lines. The "Clip mm:ss–mm:ss" button appears. Click it: a clip shows "Preparing…" and then Copy link.
  3. **Old meeting:** open a meeting made before this plan. It renders, with no Highlights section and "No clips yet".
  4. **Delete:** delete a clip and confirm. It disappears.

- [ ] **Step 9: Verify and commit**

```bash
npm test && npx tsc --noEmit && npx eslint .
git add "app/meetings/[id]/page.tsx" components/meeting-view.tsx components/transcript-view.tsx components/summary-view.tsx \
  components/recorder.tsx components/clips-panel.tsx components/highlight-bar.tsx
git commit -m "feat: highlight button, clip from transcript selection, clip list and player markers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 6: Public share page

**Files:**
- Move: `app/page.tsx`, `app/new/`, `app/meetings/` → `app/(app)/`. The routes are unchanged.
- Create: `app/(app)/layout.tsx`, `app/c/[token]/page.tsx`
- Modify: `app/layout.tsx` (the nav moves out)

**Interfaces:**
- Consumes: `isShareToken` (Task 1), `clips`, `meetings`, `utterances`, `speakerName`, `formatTimestamp`
- Produces: `GET /c/:token` (a public page)

- [ ] **Step 1: Move the site nav into a route group**, so `/c/*` renders without it:

```bash
mkdir -p "app/(app)"
git mv app/page.tsx "app/(app)/page.tsx"
git mv app/new "app/(app)/new"
git mv app/meetings "app/(app)/meetings"
```

Create `app/(app)/layout.tsx` with the `<header>…</header>` block cut from `app/layout.tsx` (with `import Link from "next/link";`):

```tsx
import Link from "next/link";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <header className="border-b">
        <nav className="mx-auto flex max-w-6xl items-center justify-between p-4">
          <Link href="/" className="font-semibold">Fanthom</Link>
          <Link href="/new" className="text-sm font-medium underline-offset-4 hover:underline">New meeting</Link>
        </nav>
      </header>
      {children}
    </>
  );
}
```

In `app/layout.tsx`, delete the `<header>` and the now-unused `Link` import. The body then renders `{children}` only.

Run: `npm run build`
Expected: it builds. The route list still shows `/`, `/new` and `/meetings/[id]` (`LayoutProps<"/">` is the typed-routes helper already used by the root layout. If typegen rejects it for a group layout, use `{ children }: { children: React.ReactNode }`).

- [ ] **Step 2: Write `app/c/[token]/page.tsx`**

```tsx
import { and, asc, eq, gt, lt } from 'drizzle-orm';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { isShareToken } from '@/lib/clips/logic';
import { db } from '@/lib/db';
import { clips, meetings, utterances } from '@/lib/db/schema';
import { formatTimestamp } from '@/lib/transcript/format';
import { speakerName } from '@/lib/transcript/speakers';

// Only clip fields and the meeting's title and names are selected: the meeting's own audio URL never reaches this page.
const loadClip = cache(async (token: string) => {
  if (!isShareToken(token)) return null;
  const [row] = await db
    .select({
      title: clips.title,
      status: clips.status,
      startMs: clips.startMs,
      endMs: clips.endMs,
      audioUrl: clips.audioUrl,
      meetingId: clips.meetingId,
      meetingTitle: meetings.title,
      speakerNames: meetings.speakerNames,
    })
    .from(clips)
    .innerJoin(meetings, eq(meetings.id, clips.meetingId))
    .where(eq(clips.shareToken, token));
  return row ?? null;
});

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const clip = await loadClip((await params).token);
  if (!clip) return { title: 'Clip not found' };
  const title = clip.title || 'Meeting clip';
  const length = clip.startMs !== null && clip.endMs !== null ? `${formatTimestamp(clip.endMs - clip.startMs)} ` : '';
  const description = `A ${length}clip from “${clip.meetingTitle}”`;
  return { title, description, openGraph: { title, description, type: 'website' }, robots: { index: false } };
}

export default async function ClipPage({ params }: { params: Promise<{ token: string }> }) {
  const clip = await loadClip((await params).token);
  if (!clip) notFound();

  if (clip.status !== 'ready' || !clip.audioUrl || clip.startMs === null || clip.endMs === null) {
    return (
      <main className="mx-auto w-full max-w-2xl p-6">
        <p className="text-muted-foreground">This clip is still being prepared.</p>
      </main>
    );
  }

  const lines = await db
    .select({ id: utterances.id, speaker: utterances.speaker, startMs: utterances.startMs, text: utterances.text })
    .from(utterances)
    .where(and(eq(utterances.meetingId, clip.meetingId), lt(utterances.startMs, clip.endMs), gt(utterances.endMs, clip.startMs)))
    .orderBy(asc(utterances.startMs));
  const clipStart = clip.startMs;

  return (
    <main className="mx-auto w-full max-w-2xl space-y-4 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{clip.title || 'Meeting clip'}</h1>
        <p className="text-sm text-muted-foreground">from {clip.meetingTitle}</p>
      </header>
      <audio src={clip.audioUrl} controls preload="metadata" className="w-full" />
      <ol className="space-y-3 text-sm">
        {lines.map((l) => (
          <li key={l.id}>
            <span className="mr-2 font-mono text-xs text-muted-foreground">{formatTimestamp(Math.max(0, l.startMs - clipStart))}</span>
            <span className="font-medium">{speakerName(l.speaker, clip.speakerNames)}</span>
            <p className="mt-1 leading-relaxed">{l.text}</p>
          </li>
        ))}
      </ol>
      <p className="pt-4 text-xs text-muted-foreground">Shared with Fanthom</p>
    </main>
  );
}
```

- [ ] **Step 3: Check it live (local).** Using a ready clip's token `T` from Task 5:

```bash
curl -s localhost:3000/c/T -o "$TMPDIR/clip.html" -w '%{http_code}\n'           # → 200
grep -c 'clips/' "$TMPDIR/clip.html"                                             # ≥ 1 (the clip's audio)
grep -c 'meetings/' "$TMPDIR/clip.html"                                          # → 0 (no meeting Blob path, no meeting link)
grep -o '<meta property="og:title"[^>]*>' "$TMPDIR/clip.html"                    # → the clip title
curl -s localhost:3000/c/not-a-token -o /dev/null -w '%{http_code}\n'           # → 404
curl -s localhost:3000/c/AAAAAAAAAAAAAAAAAAAAAA -o /dev/null -w '%{http_code}\n'  # → 404
```

`meetings/` matches the uploaded (`meetings/…`) and bot (`meetings/bot-…`) Blob paths and `/meetings/<id>` links. A recorder upload's path is `recordings/…`, so also run `grep -c 'recordings/' "$TMPDIR/clip.html"` → `0`.

In the browser, `/c/T` shows no header nav. The clip plays, and the excerpt shows speaker names with times starting at 00:00. `/` and `/meetings/<id>` still show the nav.

- [ ] **Step 4: Verify and commit**

```bash
npm test && npx tsc --noEmit && npx eslint . && npm run build
git add app/
git commit -m "feat: public clip share page without access to the rest of the meeting

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 7: Docs, deploy, live checks

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README.**
  - **"What it does":** add highlights (a button during bot and browser recordings), clips from any transcript selection, and public share links that expose only the clip.
  - **Architecture:** add a short "Highlights and clips" subsection:
    - the `clips` table and its statuses
    - live marks placed in `summarizeMeeting` (a 30 s/5 s window snapped to utterances, 15 s max snap)
    - Claude labels
    - the ffmpeg cut into its own Blob, with 3-minute stale recovery
    - `/c/[token]`
  - **Trade-offs:**
    - ffmpeg-static runs in Vercel functions (binary traced via `outputFileTracingIncludes`)
    - clips are audio only
    - share links are unguessable but unauthenticated, like the rest of the app
    - the WebM seek cost from Task 3 Step 7, if it was notable.
  - **"What I'd do next":** remove the items that are now done.

- [ ] **Step 2: Verify and deploy**

```bash
npm test && npx tsc --noEmit && npx eslint . && npm run build
vercel deploy --prod --yes
```

Expected: everything passes, and the deployment is `READY`.

- [ ] **Step 3: Live checks on production** (the user runs the bot call)
  1. **Bot highlight:** send the bot to the user's Meet from `/new` → "Join a meeting".
     - Before it's recording, Highlight isn't shown.
     - Once it's recording, press Highlight twice, about 40 s apart. Each shows `Highlighted at mm:ss`, and the Clips list shows "Lands after processing".
     - Press Stop. Once ready, both highlights are labeled in the summary, marked on the player, banded in the transcript, and `ready` in the Clips list.
  2. **ffmpeg on Vercel:** step 1's clips became `ready`, which proves the traced binary runs. If they failed, read the clip's error and `vercel logs --environment production --since 15m`.
  3. **Share:** copy a link and open it in a private window. Only the clip plays, and view-source contains no `meetings/` or `recordings/` Blob URL.
  4. **Delete:** delete that clip. The share link returns 404, and the clip's Blob URL returns 404.
  5. `vercel logs --environment production --since 15m --status-code 5xx` shows no 5xx errors.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: README for highlights and shareable clips

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
