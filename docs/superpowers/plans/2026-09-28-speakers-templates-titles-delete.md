# Speaker Names, Templates, Auto Titles and Delete — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real speaker names (manual and automatic for bot meetings), five summary templates, Claude-written titles for untitled meetings, and deleting meetings.

**Architecture:**
- Three new `meetings` columns (`speaker_names` jsonb, `template` enum, `title_is_auto` boolean) plus two new summary fields (`title`, `sections`).
- One shared `startResummarize(id)` (an atomic `ready → summarizing` claim followed by `after(summarizeMeeting)`) serves both speaker renames and template changes.
- `summarizeMeeting` reads the meeting's names, template and auto-title flag, so every summary path uses them.
- Bot meetings get names from Recall's speaker timeline, matched to AssemblyAI's labels by time overlap before the first summary.

**Tech Stack:** Next.js 16.3 App Router, Drizzle 0.45 + Neon, AI SDK 7 (`generateText` + `Output.object`), `@vercel/blob` 2.8 (`del`), the Recall.ai REST API, zod 4, vitest 5.

**Spec:** `docs/superpowers/specs/2026-09-28-speakers-templates-titles-delete-design.md`

## Global Constraints

- Never modify or delete `.claude/`, `.agent-logs/` or `CAPTURE-TEST.md`. Never commit `.env*` or audio files.
- Next 16: `params` are Promises. Background work uses `after()` from `next/server`. Check `node_modules/next/dist/docs/` before writing new route code (AGENTS.md).
- There is no auth, so anyone can rename, retemplate, retitle or delete.
- Values, exactly:
  - Speaker name: trimmed, 1–60 characters. An empty name clears it back to the letter.
  - Display fallback: `Speaker ${label}`.
  - Edited title: trimmed, 1–200 characters.
  - Untitled placeholder: `Untitled meeting`.
  - Auto title: at most 8 words.
- Templates and headings, exactly:
  - `general`: no sections.
  - `sales`: Customer needs, Objections, Budget & timeline, Next steps.
  - `one_on_one`: Wins, Concerns, Feedback, Follow-ups.
  - `standup`: Yesterday, Today, Blockers.
  - `interview`: Candidate background, Strengths, Concerns, Recommendation.
  - Labels: General, Sales call, 1:1, Standup, Interview.
- Delete confirm text, exactly: `Delete this meeting? This removes the recording and transcript permanently.`
- Speaker matching: the participant with the greatest overlap wins, and only when the overlap is at least 50% of that label's talk time. Ties go to whoever appears first in the timeline. A missing end time uses the next entry's start (or ∞ for the last). Any Recall failure keeps the letters and never fails the meeting.
- Old summaries (without `title`/`sections`) and old meetings (without a template) must keep rendering. Guard with `?? []` and column defaults.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work on branch `feat/speakers-templates`.

## Review Focus

1. **A rename or template change while a summary is already running** (or two renames in quick succession). Expected: the value is saved, no second summary starts, and the response shows `status: "summarizing"`. Pinned in Task 2 Step 9 (a double rename by curl).
2. **Deleting a meeting while background work runs on it** (summarizing, copying bot audio). Expected: the row stays deleted and no background error resurrects or crashes anything. Pinned in Task 5 Step 5 (re-summarize, then delete immediately).
3. **Hostile or odd speaker names:** whitespace-only, 61+ characters, HTML like `<b>x</b>`, or a label that isn't in the meeting. Expected: cleared, 400, rendered as plain text, 400. Pinned in Task 2 Step 9 (curl) and Task 4 Step 6 (browser rendering).
4. **Recall timeline missing, malformed or not overlapping** (bot joined late, one person speaking over another). Expected: letters are kept and the meeting reaches `ready`. Pinned in Task 3 (`timelineFromRecall` garbage input, and the `matchSpeakers` below-threshold test).
5. **Pre-existing meetings** (old summaries without `title`/`sections`, default template). Expected: they render, and switching one to a template produces the template sections. Pinned in Task 4 Step 6 (retemplate "Wildfire smoke interview").

---

## File Structure

```
lib/transcript/speakers.ts     speakerName, matchSpeakers, TimelineSpan (pure)
lib/transcript/format.ts       (modify) formatTranscript(lines, names?)
lib/templates.ts               MEETING_TEMPLATES, MeetingTemplate, TEMPLATE_LABELS, templateHeadings, templateInstructions (pure)
lib/titles.ts                  UNTITLED, resolveCreateTitle, pickAutoTitle (pure)
lib/summary-schema.ts          (modify) + title, sections
lib/pipeline/prompts.ts        (modify) SUMMARY_INSTRUCTIONS mentions names
lib/pipeline/summarize.ts      (modify) summarize(transcript, template)
lib/pipeline/advance.ts        (modify) summarizeMeeting uses names/template/auto title; bot naming before first summary
lib/pipeline/resummarize.ts    startResummarize(id)
lib/bot/recall.ts              (modify) getSpeakerTimeline, timelineFromRecall
lib/bot/speakers.ts            nameBotSpeakers(meetingId, botId, rows)
lib/db/schema.ts               (modify) meeting_template enum, template, speaker_names, title_is_auto
lib/search/search.ts           (modify) hits carry speaker name
lib/summary-markdown.ts        (modify) sections
lib/client/media.ts            (modify) template in create inputs, drop defaultTitle
app/api/meetings/route.ts, app/api/meetings/bot/route.ts   (modify) template + untitled
app/api/meetings/[id]/route.ts             (modify) + PATCH (title/template) + DELETE
app/api/meetings/[id]/speakers/route.ts    PATCH rename
app/api/meetings/[id]/resummarize/route.ts POST
app/api/meetings/[id]/chat/route.ts        (modify) names in prompt
app/meetings/[id]/page.tsx                 (modify) pass template, speakerNames
components/template-select.tsx             native select of templates
components/meeting-header.tsx              editable title, template select, delete
components/transcript-view.tsx             (modify) named + renameable speakers
components/summary-view.tsx                (modify) sections
components/meeting-view.tsx                (modify) uses MeetingHeader, rename handler
components/search-results.tsx              (modify) speaker name
components/uploader.tsx, recorder.tsx, bot-joiner.tsx      (modify) template select, no date title
tests/speakers.test.ts tests/templates.test.ts tests/titles.test.ts tests/format.test.ts tests/summary-markdown.test.ts (modify)
README.md
```

---

## Task 1: Pure speaker naming

**Files:**
- Create: `lib/transcript/speakers.ts`, `tests/speakers.test.ts`
- Modify: `lib/transcript/format.ts`, `tests/format.test.ts`

**Interfaces:**
- Produces:
  - `speakerName(label: string, names: Record<string, string>): string`
  - `type TimelineSpan = { name: string; startMs: number; endMs: number | null }`
  - `matchSpeakers(utterances: { speaker: string; startMs: number; endMs: number }[], timeline: TimelineSpan[]): Record<string, string>`
  - `formatTranscript(lines: TranscriptLine[], names?: Record<string, string>): string`

- [ ] **Step 1: Branch**

```bash
git switch -c feat/speakers-templates
```

- [ ] **Step 2: Write the failing tests** in `tests/speakers.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { matchSpeakers, speakerName } from '../lib/transcript/speakers';

const u = (speaker: string, startMs: number, endMs: number) => ({ speaker, startMs, endMs });

describe('speakerName', () => {
  it('uses the saved name, else the letter', () => {
    expect(speakerName('A', { A: 'Priya' })).toBe('Priya');
    expect(speakerName('B', { A: 'Priya' })).toBe('Speaker B');
    expect(speakerName('A', { A: '   ' })).toBe('Speaker A');
  });
});

describe('matchSpeakers', () => {
  it('maps each label to the participant it overlaps most', () => {
    const utts = [u('A', 0, 10_000), u('B', 10_000, 20_000), u('A', 20_000, 25_000)];
    const timeline = [
      { name: 'Priya', startMs: 0, endMs: 10_500 },
      { name: 'Sam', startMs: 10_500, endMs: 19_000 },
      { name: 'Priya', startMs: 19_000, endMs: 26_000 },
    ];
    expect(matchSpeakers(utts, timeline)).toEqual({ A: 'Priya', B: 'Sam' });
  });
  it('leaves a label unnamed when no participant covers half its talk time', () => {
    expect(matchSpeakers([u('A', 0, 10_000)], [{ name: 'Priya', startMs: 6_000, endMs: 10_000 }])).toEqual({});
  });
  it('treats a missing end as running until the next entry starts, or forever', () => {
    const timeline = [
      { name: 'Priya', startMs: 0, endMs: null },
      { name: 'Sam', startMs: 8_000, endMs: null },
    ];
    expect(matchSpeakers([u('A', 0, 8_000), u('B', 8_000, 60_000)], timeline)).toEqual({ A: 'Priya', B: 'Sam' });
  });
  it('breaks ties in favour of the participant listed first', () => {
    const timeline = [
      { name: 'Priya', startMs: 0, endMs: 5_000 },
      { name: 'Sam', startMs: 5_000, endMs: 10_000 },
    ];
    expect(matchSpeakers([u('A', 0, 10_000)], timeline)).toEqual({ A: 'Priya' });
  });
  it('allows two labels to map to the same person', () => {
    const timeline = [{ name: 'Priya', startMs: 0, endMs: 20_000 }];
    expect(matchSpeakers([u('A', 0, 5_000), u('B', 6_000, 12_000)], timeline)).toEqual({ A: 'Priya', B: 'Priya' });
  });
  it('returns nothing for an empty timeline', () => {
    expect(matchSpeakers([u('A', 0, 5_000)], [])).toEqual({});
  });
});
```

Append to `tests/format.test.ts`, inside a new describe block at the end:

```ts
describe('formatTranscript with names', () => {
  it('uses saved names and keeps letters for the rest', () => {
    expect(
      formatTranscript(
        [
          { speaker: 'A', startMs: 0, text: 'Hi.' },
          { speaker: 'B', startMs: 1_000, text: 'Hello.' },
        ],
        { A: 'Priya' },
      ),
    ).toBe('[00:00] Priya: Hi.\n[00:01] Speaker B: Hello.');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL. `lib/transcript/speakers` can't be resolved, and `formatTranscript` ignores `names` (so the output still says "Speaker A").

- [ ] **Step 4: Implement `lib/transcript/speakers.ts`**

```ts
export type TimelineSpan = { name: string; startMs: number; endMs: number | null };

export function speakerName(label: string, names: Record<string, string>): string {
  return names[label]?.trim() || `Speaker ${label}`;
}

// Name each diarization label after the meeting participant whose speaking time it overlaps most.
export function matchSpeakers(
  utterances: { speaker: string; startMs: number; endMs: number }[],
  timeline: TimelineSpan[],
): Record<string, string> {
  const byStart = [...timeline].sort((a, b) => a.startMs - b.startMs);
  const spans = byStart.map((t, i) => ({ name: t.name, start: t.startMs, end: t.endMs ?? byStart[i + 1]?.startMs ?? Infinity }));
  const order = [...new Set(timeline.map((t) => t.name))];

  const talk = new Map<string, number>();
  const overlap = new Map<string, Map<string, number>>();
  for (const u of utterances) {
    talk.set(u.speaker, (talk.get(u.speaker) ?? 0) + (u.endMs - u.startMs));
    const perName = overlap.get(u.speaker) ?? new Map(order.map((n) => [n, 0]));
    for (const s of spans) {
      const ms = Math.min(u.endMs, s.end) - Math.max(u.startMs, s.start);
      if (ms > 0) perName.set(s.name, (perName.get(s.name) ?? 0) + ms);
    }
    overlap.set(u.speaker, perName);
  }

  const names: Record<string, string> = {};
  for (const [label, perName] of overlap) {
    let best: { name: string; ms: number } | null = null;
    for (const [name, ms] of perName) if (!best || ms > best.ms) best = { name, ms };
    const total = talk.get(label) ?? 0;
    if (best && total > 0 && best.ms >= total / 2) names[label] = best.name;
  }
  return names;
}
```

- [ ] **Step 5: Update `lib/transcript/format.ts`**

Add `import { speakerName } from './speakers';` at the top, and replace `formatTranscript` with:

```ts
export function formatTranscript(lines: TranscriptLine[], names: Record<string, string> = {}): string {
  return lines.map((l) => `[${formatTimestamp(l.startMs)}] ${speakerName(l.speaker, names)}: ${l.text}`).join('\n');
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test && npx tsc --noEmit`
Expected: PASS. The old `formatTranscript` test still passes, because no names means "Speaker A".

- [ ] **Step 7: Commit**

```bash
git add lib/transcript/speakers.ts lib/transcript/format.ts tests/speakers.test.ts tests/format.test.ts
git commit -m "feat: speaker name display and timeline matching"
```

---

## Task 2: Schema, re-summarize, manual rename, names everywhere

**Files:**
- Create:
  - `lib/templates.ts` (only the enum values in this task)
  - `lib/pipeline/resummarize.ts`
  - `app/api/meetings/[id]/resummarize/route.ts`
  - `app/api/meetings/[id]/speakers/route.ts`
  - `drizzle/0002_*.sql` (generated)
- Modify:
  - `lib/db/schema.ts`
  - `lib/pipeline/advance.ts`
  - `lib/pipeline/prompts.ts`
  - `app/api/meetings/[id]/chat/route.ts`
  - `lib/search/search.ts`
  - `components/search-results.tsx`
  - `components/transcript-view.tsx`
  - `components/meeting-view.tsx`
  - `app/meetings/[id]/page.tsx`

**Interfaces:**
- Consumes: `speakerName`, `formatTranscript(lines, names)` (Task 1)
- Produces:
  - Columns: `meetings.speakerNames: Record<string,string>`, `meetings.template: MeetingTemplate`, `meetings.titleIsAuto: boolean`
  - `MEETING_TEMPLATES`, `type MeetingTemplate` (in `lib/templates.ts`)
  - `startResummarize(id: string): Promise<boolean>`
  - `POST /api/meetings/:id/resummarize` → `202 {status}` | `404` | `409`
  - `PATCH /api/meetings/:id/speakers {label, name}` → `200 {speakerNames, status}` | `400` | `404`
  - `SearchHit.speaker: string | null`
  - `TranscriptView({ lines, activeId, onSeek, speakerNames, onRename })`
  - `MeetingViewProps.meeting.speakerNames`, `MeetingViewProps.meeting.template`

- [ ] **Step 1: Create `lib/templates.ts`** (Task 4 adds the rest)

```ts
export const MEETING_TEMPLATES = ['general', 'sales', 'one_on_one', 'standup', 'interview'] as const;
export type MeetingTemplate = (typeof MEETING_TEMPLATES)[number];
```

- [ ] **Step 2: Edit `lib/db/schema.ts`**

Add `import { MEETING_TEMPLATES } from '../templates';` and `boolean` to the `drizzle-orm/pg-core` import. Under `meetingSource`, add:

```ts
export const meetingTemplate = pgEnum('meeting_template', MEETING_TEMPLATES);
```

In the `meetings` table, after `botStatus`, add:

```ts
  template: meetingTemplate('template').notNull().default('general'),
  speakerNames: jsonb('speaker_names').$type<Record<string, string>>().notNull().default({}),
  titleIsAuto: boolean('title_is_auto').notNull().default(false),
```

- [ ] **Step 3: Generate and apply the migration**

Run: `npm run db:generate && cat drizzle/0002_*.sql`
Expected: `CREATE TYPE "public"."meeting_template"`, then three `ADD COLUMN` statements with the defaults `'general'`, `'{}'::jsonb` and `false`, and no DROP statements.
Then run: `npm run db:migrate`. Expected: "migrations applied successfully".

- [ ] **Step 4: Create `lib/pipeline/resummarize.ts`**

```ts
import { and, eq } from 'drizzle-orm';
import { after } from 'next/server';
import { db } from '../db';
import { meetings } from '../db/schema';
import { summarizeMeeting } from './advance';

// Renames and template changes regenerate the summary. Only a `ready` meeting is claimed, so a
// summary that is already running is never doubled; it picks up the saved change when it reads the meeting.
export async function startResummarize(id: string): Promise<boolean> {
  const claimed = await db
    .update(meetings)
    .set({ status: 'summarizing', error: null })
    .where(and(eq(meetings.id, id), eq(meetings.status, 'ready')))
    .returning({ id: meetings.id });
  if (claimed.length === 0) return false;
  after(() => summarizeMeeting(id));
  return true;
}
```

- [ ] **Step 5: `summarizeMeeting` uses names** (the template and auto title come in Task 4)

In `lib/pipeline/advance.ts`, replace the start of `summarizeMeeting` up to the `try {` with:

```ts
export async function summarizeMeeting(id: string): Promise<void> {
  const meeting = await db.query.meetings.findFirst({
    where: eq(meetings.id, id),
    columns: { speakerNames: true },
  });
  if (!meeting) return;
  const lines = await db
    .select({ speaker: utterances.speaker, startMs: utterances.startMs, text: utterances.text })
    .from(utterances)
    .where(eq(utterances.meetingId, id))
    .orderBy(asc(utterances.startMs));
```

and in the `try` block, change `formatTranscript(lines)` to `formatTranscript(lines, meeting.speakerNames)`.

In `lib/pipeline/prompts.ts`, replace the second line of `SUMMARY_INSTRUCTIONS` with:

```
The transcript lines look like "[mm:ss] Name: text". A speaker is either a real name or an anonymous label like "Speaker A". Use the name exactly as shown for owners; if a speaker is only a label but participants address them by name, use that name.
```

In `app/api/meetings/[id]/chat/route.ts`, select `columns: { title: true, status: true, speakerNames: true }`, and pass `formatTranscript(lines, meeting.speakerNames)`.

- [ ] **Step 6: Create `app/api/meetings/[id]/resummarize/route.ts`**

```ts
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
```

- [ ] **Step 7: Create `app/api/meetings/[id]/speakers/route.ts`** (atomic jsonb update, so two quick renames don't overwrite each other)

```ts
import { and, eq, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { meetings, utterances } from '@/lib/db/schema';
import { isUuid } from '@/lib/ids';
import { startResummarize } from '@/lib/pipeline/resummarize';

export const maxDuration = 300;

const renameSchema = z.object({
  label: z.string().min(1).max(10),
  name: z.string().trim().max(60),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const parsed = renameSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  const { label, name } = parsed.data;

  const meeting = await db.query.meetings.findFirst({ where: eq(meetings.id, id), columns: { id: true } });
  if (!meeting) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const [used] = await db
    .select({ id: utterances.id })
    .from(utterances)
    .where(and(eq(utterances.meetingId, id), eq(utterances.speaker, label)))
    .limit(1);
  if (!used) return NextResponse.json({ error: `Speaker ${label} is not in this meeting` }, { status: 400 });

  const next = name
    ? sql`${meetings.speakerNames} || jsonb_build_object(${label}::text, ${name}::text)`
    : sql`${meetings.speakerNames} - ${label}::text`;
  const [updated] = await db
    .update(meetings)
    .set({ speakerNames: next })
    .where(eq(meetings.id, id))
    .returning({ speakerNames: meetings.speakerNames, status: meetings.status });
  const started = updated.status === 'ready' && (await startResummarize(id));
  return NextResponse.json({ speakerNames: updated.speakerNames, status: started ? 'summarizing' : updated.status });
}
```

- [ ] **Step 8: Names in the UI and in search**

`lib/search/search.ts`:
- Add `import { speakerName } from '../transcript/speakers';`.
- Change `SearchHit` to add `speaker: string | null`.
- In the title-hit select, add `null::text as speaker, '{}'::jsonb as "speakerNames"`. In the line-hit select, add `u.speaker, m.speaker_names as "speakerNames"`.
- Replace the return with:

```ts
  type Row = Omit<SearchHit, 'speaker'> & { speaker: string | null; speakerNames: Record<string, string> };
  return ([...titleHits.rows, ...lineHits.rows] as Row[]).map(({ speakerNames, ...hit }) => ({
    ...hit,
    speaker: hit.speaker === null ? null : speakerName(hit.speaker, speakerNames),
  }));
```

`components/search-results.tsx`: inside the snippet `<p>`, before the highlighted parts, add `{h.speaker && <span className="font-medium text-foreground">{h.speaker}: </span>}`.

`components/transcript-view.tsx` (replace the file):

```tsx
'use client';

import { useState } from 'react';
import { formatTimestamp } from '@/lib/transcript/format';
import { speakerName } from '@/lib/transcript/speakers';

const SPEAKER_COLORS = ['text-blue-600', 'text-emerald-600', 'text-amber-600', 'text-fuchsia-600', 'text-cyan-600', 'text-rose-600'];

export function speakerColor(speaker: string): string {
  return SPEAKER_COLORS[speaker.charCodeAt(0) % SPEAKER_COLORS.length];
}

export type Line = { id: number; speaker: string; startMs: number; text: string };

type Props = {
  lines: Line[];
  activeId: number | null;
  onSeek: (ms: number) => void;
  speakerNames: Record<string, string>;
  onRename: (label: string, name: string) => void;
};

export function TranscriptView({ lines, activeId, onSeek, speakerNames, onRename }: Props) {
  if (lines.length === 0) return <p className="text-sm text-muted-foreground">No speech was detected.</p>;
  return (
    <ol className="space-y-3 text-sm">
      {lines.map((l) => (
        <li key={l.id} id={`u-${l.id}`} className={`rounded p-2 ${l.id === activeId ? 'bg-muted' : ''}`}>
          <button type="button" onClick={() => onSeek(l.startMs)} className="mr-2 font-mono text-xs text-muted-foreground hover:underline">
            {formatTimestamp(l.startMs)}
          </button>
          <SpeakerLabel label={l.speaker} names={speakerNames} onRename={onRename} />
          <p className="mt-1 leading-relaxed">{l.text}</p>
        </li>
      ))}
    </ol>
  );
}

function SpeakerLabel({ label, names, onRename }: { label: string; names: Record<string, string>; onRename: (label: string, name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  if (editing) {
    return (
      <input
        autoFocus
        value={value}
        maxLength={60}
        aria-label={`Name for Speaker ${label}`}
        placeholder={`Speaker ${label}`}
        className="rounded border px-1 text-sm"
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            setEditing(false);
            onRename(label, value.trim());
          }
          if (e.key === 'Escape') setEditing(false);
        }}
      />
    );
  }
  return (
    <button
      type="button"
      title="Rename this speaker"
      onClick={() => {
        setValue(names[label] ?? '');
        setEditing(true);
      }}
      className={`font-medium hover:underline ${speakerColor(label)}`}
    >
      {speakerName(label, names)}
    </button>
  );
}
```

`components/meeting-view.tsx`:
- Add `speakerNames: Record<string, string>;` and `template: MeetingTemplate;` to `MeetingViewProps.meeting` (import `type MeetingTemplate` from `@/lib/templates`).
- Add a rename handler next to `retry`:

```tsx
  const [actionError, setActionError] = useState<string | null>(null);
  async function renameSpeaker(label: string, name: string) {
    setActionError(null);
    const res = await fetch(`/api/meetings/${meeting.id}/speakers`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label, name }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setActionError(data.error ?? 'Could not rename the speaker.');
    }
    router.refresh();
  }
```

- Pass `speakerNames={meeting.speakerNames} onRename={renameSpeaker}` to `<TranscriptView …/>`.
- Directly under the `<header>` element, render `{actionError && <p className="text-sm text-destructive">{actionError}</p>}`.

`app/meetings/[id]/page.tsx`: add `speakerNames: meeting.speakerNames, template: meeting.template,` to the `meeting={{…}}` prop.

- [ ] **Step 9: Verify**

Run: `npx tsc --noEmit && npm test && npx eslint .` → clean. Then, with `npm run dev` running and `ID` set to the "Wildfire smoke interview" meeting:

```bash
p(){ curl -s -X PATCH localhost:3000/api/meetings/$ID/speakers -H 'content-type: application/json' -d "$1" -w " %{http_code}\n"; }
p '{"label":"A","name":"Host"}'            # 200, status summarizing
p '{"label":"B","name":"Peter DeCarlo"}'   # 200, status summarizing (saved; no second summary started)
p '{"label":"Z","name":"Nobody"}'          # 400 not in this meeting
p "{\"label\":\"A\",\"name\":\"$(printf 'x%.0s' {1..61})\"}"  # 400
p '{"label":"A"}'                          # 400
curl -s -X POST localhost:3000/api/meetings/not-a-uuid/resummarize -o /dev/null -w '%{http_code}\n'   # 404
```

Poll `GET /api/meetings/$ID` until the status is ready. Expected:
- The summary JSON mentions "Peter DeCarlo".
- `curl -s 'localhost:3000/?q=particulate'` HTML contains `Peter DeCarlo: `.
- `POST /resummarize` on the ready meeting returns `202`; calling it again immediately returns `409`.

Rename the speakers back afterwards (`{"label":"A","name":""}` and the same for B), or keep them if the user prefers.

- [ ] **Step 10: Commit**

```bash
git add lib/templates.ts lib/db/schema.ts drizzle lib/pipeline/resummarize.ts lib/pipeline/advance.ts lib/pipeline/prompts.ts 'app/api/meetings/[id]/resummarize' 'app/api/meetings/[id]/speakers' 'app/api/meetings/[id]/chat/route.ts' lib/search/search.ts components/search-results.tsx components/transcript-view.tsx components/meeting-view.tsx 'app/meetings/[id]/page.tsx'
git commit -m "feat: rename speakers; names flow into transcript, summary, chat and search"
```

---

## Task 3: Automatic speaker names for bot meetings

**Files:**
- Create: `lib/bot/speakers.ts`
- Modify: `lib/bot/recall.ts`, `lib/pipeline/advance.ts`, `tests/speakers.test.ts`

**Interfaces:**
- Consumes: `matchSpeakers`, `TimelineSpan` (Task 1); `speakerNames` column (Task 2)
- Produces:
  - `timelineFromRecall(raw: unknown): TimelineSpan[]`
  - `getSpeakerTimeline(botId: string): Promise<TimelineSpan[] | null>`
  - `nameBotSpeakers(meetingId: string, botId: string, rows: { speaker: string; startMs: number; endMs: number }[]): Promise<void>`

- [ ] **Step 1: Write the failing test.** Append to `tests/speakers.test.ts`:

```ts
import { timelineFromRecall } from '../lib/bot/recall';

describe('timelineFromRecall', () => {
  it('converts Recall timeline entries to spans in ms', () => {
    const raw = [
      { participant: { id: 100, name: 'Sayan De' }, start_timestamp: { relative: 0.08172315 }, end_timestamp: { relative: 4.5 } },
      { participant: { id: 101, name: 'Priya' }, start_timestamp: { relative: 4.5 }, end_timestamp: null },
    ];
    expect(timelineFromRecall(raw)).toEqual([
      { name: 'Sayan De', startMs: 82, endMs: 4_500 },
      { name: 'Priya', startMs: 4_500, endMs: null },
    ]);
  });
  it('skips malformed entries and tolerates garbage', () => {
    expect(timelineFromRecall([{ participant: {}, start_timestamp: { relative: 1 } }, { nope: true }, null])).toEqual([]);
    expect(timelineFromRecall({ not: 'an array' })).toEqual([]);
    expect(timelineFromRecall(null)).toEqual([]);
  });
});
```

(Move the new import to the top of the file.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- tests/speakers.test.ts`
Expected: FAIL, because `timelineFromRecall` is not exported.

- [ ] **Step 3: Add to `lib/bot/recall.ts`**

Add `import type { TimelineSpan } from '../transcript/speakers';` at the top, then append:

```ts
type RawTimelineEntry = {
  participant?: { name?: unknown } | null;
  start_timestamp?: { relative?: unknown } | null;
  end_timestamp?: { relative?: unknown } | null;
} | null;

export function timelineFromRecall(raw: unknown): TimelineSpan[] {
  if (!Array.isArray(raw)) return [];
  const spans: TimelineSpan[] = [];
  for (const entry of raw as RawTimelineEntry[]) {
    const name = entry?.participant?.name;
    const start = entry?.start_timestamp?.relative;
    const end = entry?.end_timestamp?.relative;
    if (typeof name !== 'string' || !name.trim() || typeof start !== 'number') continue;
    spans.push({ name: name.trim(), startMs: Math.round(start * 1000), endMs: typeof end === 'number' ? Math.round(end * 1000) : null });
  }
  return spans;
}

// Who spoke when, with Meet display names; offsets are relative to the start of the recording.
export async function getSpeakerTimeline(botId: string): Promise<TimelineSpan[] | null> {
  const bot = await recall<{
    recordings?: { media_shortcuts?: { participant_events?: { data?: { speaker_timeline_download_url?: string | null } | null } | null } | null }[];
  }>(`/bot/${encodeURIComponent(botId)}/`);
  const url = bot.recordings?.[0]?.media_shortcuts?.participant_events?.data?.speaker_timeline_download_url;
  if (!url) return null;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`speaker timeline download failed (${res.status})`);
  return timelineFromRecall(await res.json());
}
```

- [ ] **Step 4: Create `lib/bot/speakers.ts`**

```ts
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { meetings } from '../db/schema';
import { matchSpeakers } from '../transcript/speakers';
import { getSpeakerTimeline } from './recall';

// Best effort: a missing or odd timeline keeps the "Speaker A" labels and never fails the meeting.
export async function nameBotSpeakers(
  meetingId: string,
  botId: string,
  rows: { speaker: string; startMs: number; endMs: number }[],
): Promise<void> {
  try {
    const timeline = await getSpeakerTimeline(botId);
    if (!timeline || timeline.length === 0) return;
    const names = matchSpeakers(rows, timeline);
    if (Object.keys(names).length > 0) await db.update(meetings).set({ speakerNames: names }).where(eq(meetings.id, meetingId));
  } catch (err) {
    console.error('Naming bot speakers failed', meetingId, err);
  }
}
```

- [ ] **Step 5: Call it before the first summary.** In `lib/pipeline/advance.ts`, import `nameBotSpeakers` from `'../bot/speakers'`, and change the end of `advanceMeeting` to:

```ts
  const rows = mapUtterances(id, transcript.utterances);
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    await db.insert(utterances).values(rows.slice(i, i + INSERT_CHUNK));
  }
  if (meeting.source === 'bot' && meeting.recallBotId) await nameBotSpeakers(id, meeting.recallBotId, rows);
  await summarizeMeeting(id);
```

- [ ] **Step 6: Tests and live check**

Run: `npm test && npx tsc --noEmit && npx eslint .` → clean.

Live check, reusing a finished bot whose recording is still stored: `182aeb65-f1c9-489e-b550-cde13bd47672` (the Task 1 probe of the Meet-bot plan, ~7-day retention; it has no meeting row, so `recall_bot_id` is free). With `npm run dev` running:
1. Insert a row: `insert into meetings (title, source, status, recall_bot_id) values ('Bot names check','bot','in_meeting','182aeb65-f1c9-489e-b550-cde13bd47672') returning id`.
2. Poll `GET /api/meetings/<id>` until ready.

Expected:
- `speaker_names` is `{"A":"Sayan De"}`.
- The meeting page transcript shows "Sayan De".
- The summary refers to "Sayan De".

If that recording has expired, use the newest bot meeting's bot ID after deleting its row, or run one live bot (the user admits it). Delete the check row afterwards.

- [ ] **Step 7: Commit**

```bash
git add lib/bot/recall.ts lib/bot/speakers.ts lib/pipeline/advance.ts tests/speakers.test.ts
git commit -m "feat: name bot meeting speakers from Recall's speaker timeline"
```

---

## Task 4: Templates and auto titles

**Files:**
- Create: `lib/titles.ts`, `components/template-select.tsx`, `components/meeting-header.tsx`, `tests/templates.test.ts`, `tests/titles.test.ts`
- Modify:
  - `lib/templates.ts`
  - `lib/summary-schema.ts`
  - `lib/pipeline/summarize.ts`
  - `lib/pipeline/advance.ts`
  - `lib/summary-markdown.ts`
  - `tests/summary-markdown.test.ts`
  - `app/api/meetings/route.ts`
  - `app/api/meetings/bot/route.ts`
  - `app/api/meetings/[id]/route.ts`
  - `lib/client/media.ts`
  - `components/uploader.tsx`
  - `components/recorder.tsx`
  - `components/bot-joiner.tsx`
  - `components/summary-view.tsx`
  - `components/meeting-view.tsx`

**Interfaces:**
- Consumes: `MEETING_TEMPLATES`, `MeetingTemplate`, `startResummarize`, `template`/`titleIsAuto` columns (Task 2)
- Produces:
  - `TEMPLATE_LABELS: Record<MeetingTemplate, string>`
  - `templateHeadings(t: MeetingTemplate): string[]`
  - `templateInstructions(t: MeetingTemplate): string`
  - `UNTITLED = 'Untitled meeting'`
  - `resolveCreateTitle(input: string): { title: string; titleIsAuto: boolean }`
  - `pickAutoTitle(isAuto: boolean, summaryTitle: string | undefined): string | null`
  - `Summary.title: string`, `Summary.sections: { heading: string; items: string[] }[]`
  - `summarize(transcript: string, template?: MeetingTemplate)`
  - `PATCH /api/meetings/:id {title?, template?}` → `200 {title, template, status}` | `400` | `404`
  - `createMeeting({…, template})`, `startBot({…, template})`
  - `TemplateSelect({ value, onChange, disabled })`
  - `MeetingHeader({ meeting, onError })`

- [ ] **Step 1: Write the failing tests**

`tests/templates.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MEETING_TEMPLATES, TEMPLATE_LABELS, templateHeadings, templateInstructions } from '../lib/templates';

describe('templates', () => {
  it('has a label for every template', () => {
    expect(MEETING_TEMPLATES.map((t) => TEMPLATE_LABELS[t])).toEqual(['General', 'Sales call', '1:1', 'Standup', 'Interview']);
  });
  it('defines the exact headings per template', () => {
    expect(templateHeadings('general')).toEqual([]);
    expect(templateHeadings('sales')).toEqual(['Customer needs', 'Objections', 'Budget & timeline', 'Next steps']);
    expect(templateHeadings('one_on_one')).toEqual(['Wins', 'Concerns', 'Feedback', 'Follow-ups']);
    expect(templateHeadings('standup')).toEqual(['Yesterday', 'Today', 'Blockers']);
    expect(templateHeadings('interview')).toEqual(['Candidate background', 'Strengths', 'Concerns', 'Recommendation']);
  });
  it('tells Claude the context and headings, in order', () => {
    const sales = templateInstructions('sales');
    expect(sales).toContain('This is a sales call.');
    expect(sales).toContain('"Customer needs", "Objections", "Budget & timeline", "Next steps"');
    expect(templateInstructions('general')).toBe('Leave "sections" as an empty list.');
  });
});
```

`tests/titles.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { pickAutoTitle, resolveCreateTitle, UNTITLED } from '../lib/titles';

describe('resolveCreateTitle', () => {
  it('marks an empty title as auto', () => {
    expect(resolveCreateTitle('   ')).toEqual({ title: UNTITLED, titleIsAuto: true });
    expect(resolveCreateTitle('')).toEqual({ title: 'Untitled meeting', titleIsAuto: true });
  });
  it('keeps a typed title', () => {
    expect(resolveCreateTitle('  Weekly sync ')).toEqual({ title: 'Weekly sync', titleIsAuto: false });
  });
});

describe('pickAutoTitle', () => {
  it('uses the summary title only for auto-titled meetings', () => {
    expect(pickAutoTitle(true, ' Q3 pricing review ')).toBe('Q3 pricing review');
    expect(pickAutoTitle(false, 'Q3 pricing review')).toBeNull();
    expect(pickAutoTitle(true, '  ')).toBeNull();
    expect(pickAutoTitle(true, undefined)).toBeNull();
  });
});
```

In `tests/summary-markdown.test.ts`, add `title: '', sections: []` to the existing fixture object. Then add:

```ts
  it('includes template sections with items after key points', () => {
    const md = summaryToMarkdown('Standup', {
      title: 'Standup',
      overview: 'Daily standup.',
      keyPoints: ['Release is on track'],
      decisions: [],
      actionItems: [],
      keyMoments: [],
      sections: [
        { heading: 'Yesterday', items: ['Fixed login'] },
        { heading: 'Blockers', items: [] },
      ],
    });
    expect(md).toBe('# Standup\n\nDaily standup.\n\n## Key points\n- Release is on track\n\n## Yesterday\n- Fixed login\n');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL. `TEMPLATE_LABELS`, `templateHeadings` and `templateInstructions` are missing, `lib/titles` can't be resolved, and the Markdown output has no sections.

- [ ] **Step 3: Implement.** Append to `lib/templates.ts`:

```ts
export const TEMPLATE_LABELS: Record<MeetingTemplate, string> = {
  general: 'General',
  sales: 'Sales call',
  one_on_one: '1:1',
  standup: 'Standup',
  interview: 'Interview',
};

const SPECS: Record<MeetingTemplate, { context: string; headings: string[] } | null> = {
  general: null,
  sales: { context: 'This is a sales call.', headings: ['Customer needs', 'Objections', 'Budget & timeline', 'Next steps'] },
  one_on_one: { context: 'This is a 1:1 between a manager and a report.', headings: ['Wins', 'Concerns', 'Feedback', 'Follow-ups'] },
  standup: { context: 'This is a team standup.', headings: ['Yesterday', 'Today', 'Blockers'] },
  interview: { context: 'This is a job interview.', headings: ['Candidate background', 'Strengths', 'Concerns', 'Recommendation'] },
};

export function templateHeadings(template: MeetingTemplate): string[] {
  return SPECS[template]?.headings ?? [];
}

export function templateInstructions(template: MeetingTemplate): string {
  const spec = SPECS[template];
  if (!spec) return 'Leave "sections" as an empty list.';
  const headings = spec.headings.map((h) => `"${h}"`).join(', ');
  return `${spec.context} Fill "sections" with exactly these headings, in this order: ${headings}. Each item is one sentence. If a heading has nothing to report, give it an empty items list; never invent content.`;
}
```

`lib/titles.ts`:

```ts
export const UNTITLED = 'Untitled meeting';

export function resolveCreateTitle(input: string): { title: string; titleIsAuto: boolean } {
  const title = input.trim();
  return title ? { title, titleIsAuto: false } : { title: UNTITLED, titleIsAuto: true };
}

export function pickAutoTitle(isAuto: boolean, summaryTitle: string | undefined): string | null {
  const title = summaryTitle?.trim();
  return isAuto && title ? title.slice(0, 200) : null;
}
```

`lib/summary-schema.ts`: add as the first field of `summarySchema`:

```ts
  title: z.string().describe('A short descriptive meeting title, at most 8 words, e.g. "Q3 pricing review with Acme"'),
```

and as the last field:

```ts
  sections: z
    .array(z.object({ heading: z.string(), items: z.array(z.string()) }))
    .describe('Template-specific sections; follow the instructions for which headings to use'),
```

and add `title: '',` and `sections: [],` to `EMPTY_SUMMARY`.

`lib/summary-markdown.ts`: after the `section('Key points', …)` line, add:

```ts
  for (const part of s.sections ?? []) section(part.heading, part.items.map((i) => `- ${i}`));
```

(`s` is the function's existing `Summary` parameter.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Wire templates and titles through the pipeline, routes and UI**

`lib/pipeline/summarize.ts`: change the signature to `summarize(transcript: string, template: MeetingTemplate = 'general')` (import `type MeetingTemplate` and `templateInstructions` from `'../templates'`), and set `instructions: \`${SUMMARY_INSTRUCTIONS}\n\n${templateInstructions(template)}\``.

`lib/pipeline/advance.ts`, in `summarizeMeeting`:
- Select `columns: { speakerNames: true, template: true, titleIsAuto: true }`.
- Call `summarize(formatTranscript(lines, meeting.speakerNames), meeting.template)`.
- After the `ready` update, and still inside the `try`, add:

```ts
    const autoTitle = pickAutoTitle(meeting.titleIsAuto, summary.title);
    if (autoTitle) {
      await db.update(meetings).set({ title: autoTitle }).where(and(eq(meetings.id, id), eq(meetings.titleIsAuto, true)));
    }
```

(Import `pickAutoTitle` from `'../titles'`.)

`app/api/meetings/route.ts`:
- Change `title` to `z.string().trim().max(200).default('')` and add `template: z.enum(MEETING_TEMPLATES).default('general')`.
- Change the insert to `.values({ ...parsed.data, ...resolveCreateTitle(parsed.data.title), assemblyaiId })`.

`app/api/meetings/bot/route.ts`:
- The same two schema changes.
- Insert `...resolveCreateTitle(parsed.data.title), template: parsed.data.template`, replacing `title: parsed.data.title`.

`app/api/meetings/[id]/route.ts`: add a PATCH handler (keep GET):

```ts
const patchSchema = z
  .object({ title: z.string().trim().min(1).max(200).optional(), template: z.enum(MEETING_TEMPLATES).optional() })
  .refine((b) => b.title !== undefined || b.template !== undefined, 'Nothing to update');

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  const { title, template } = parsed.data;
  const [updated] = await db
    .update(meetings)
    .set({ ...(title !== undefined && { title, titleIsAuto: false }), ...(template !== undefined && { template }) })
    .where(eq(meetings.id, id))
    .returning({ title: meetings.title, template: meetings.template, status: meetings.status });
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const started = template !== undefined && updated.status === 'ready' && (await startResummarize(id));
  return NextResponse.json({ ...updated, status: started ? 'summarizing' : updated.status });
}
```

(Imports: `z` from `zod`, `MEETING_TEMPLATES` from `@/lib/templates`, `startResummarize` from `@/lib/pipeline/resummarize`.)

`lib/client/media.ts`: delete `defaultTitle`. Add `template: MeetingTemplate` to both `createMeeting` and `startBot` input types (import the type from `@/lib/templates`).

`components/template-select.tsx`:

```tsx
import { MEETING_TEMPLATES, type MeetingTemplate, TEMPLATE_LABELS } from '@/lib/templates';

export function TemplateSelect({
  value,
  onChange,
  disabled,
}: {
  value: MeetingTemplate;
  onChange: (t: MeetingTemplate) => void;
  disabled?: boolean;
}) {
  return (
    <select
      aria-label="Meeting template"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as MeetingTemplate)}
      className="h-8 rounded-lg border bg-background px-2 text-sm"
    >
      {MEETING_TEMPLATES.map((t) => (
        <option key={t} value={t}>
          {TEMPLATE_LABELS[t]}
        </option>
      ))}
    </select>
  );
}
```

`components/uploader.tsx`, `components/recorder.tsx` and `components/bot-joiner.tsx`:
- Remove the `defaultTitle` import and replace `title.trim() || defaultTitle()` with `title.trim()`.
- Add `const [template, setTemplate] = useState<MeetingTemplate>('general');` and pass `template` in the create call.
- Render `<TemplateSelect value={template} onChange={setTemplate} disabled={…same disabled condition as the title input…} />` directly after the title `<Input>`.
- In the uploader, delete the now-stale comment about `defaultTitle()` on the `title` state line.

`components/summary-view.tsx`: after the Key points `<Section>`, add:

```tsx
      {(summary.sections ?? [])
        .filter((s) => s.items.length > 0)
        .map((s) => (
          <Section key={s.heading} title={s.heading}>
            <ul className="list-disc space-y-1 pl-5">{s.items.map((item, i) => <li key={i}>{item}</li>)}</ul>
          </Section>
        ))}
```

`components/meeting-header.tsx` (the title editor and template switcher; Task 5 adds Delete here):

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { TemplateSelect } from '@/components/template-select';
import { Badge } from '@/components/ui/badge';
import type { MeetingStatus } from '@/lib/db/schema';
import { statusLabel } from '@/lib/status-label';
import type { MeetingTemplate } from '@/lib/templates';

type HeaderMeeting = { id: string; title: string; status: MeetingStatus; template: MeetingTemplate };

export function MeetingHeader({ meeting, onError }: { meeting: HeaderMeeting; onError: (message: string | null) => void }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(meeting.title);

  async function patch(body: { title?: string; template?: MeetingTemplate }) {
    onError(null);
    const res = await fetch(`/api/meetings/${meeting.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      onError(data.error ?? 'Could not save the change.');
    }
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {editing ? (
        <input
          autoFocus
          value={title}
          maxLength={200}
          aria-label="Meeting title"
          className="min-w-0 flex-1 rounded border px-2 text-2xl font-semibold"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setEditing(false);
            if (e.key === 'Enter' && title.trim()) {
              setEditing(false);
              void patch({ title: title.trim() });
            }
          }}
        />
      ) : (
        <h1>
          <button
            type="button"
            title="Rename this meeting"
            className="text-left text-2xl font-semibold hover:underline"
            onClick={() => {
              setTitle(meeting.title);
              setEditing(true);
            }}
          >
            {meeting.title}
          </button>
        </h1>
      )}
      <Badge variant={meeting.status === 'failed' ? 'destructive' : 'secondary'}>{statusLabel(meeting.status)}</Badge>
      <TemplateSelect
        value={meeting.template}
        disabled={meeting.status !== 'ready'}
        onChange={(template) => void patch({ template })}
      />
    </div>
  );
}
```

`components/meeting-view.tsx`: replace the `<div className="flex items-center gap-3">…</div>` holding the `<h1>` and `<Badge>` with:

```tsx
<MeetingHeader meeting={meeting} onError={setActionError} />
```

Import `MeetingHeader`. Remove the `Badge` and `statusLabel` imports if they are now unused (run eslint to see).

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit && npm test && npx eslint .` → clean. With `npm run dev` running, check in headless Chrome and with curl:
1. Upload `test-audio/wildfires.mp3` with an **empty** title and the **Interview** template.
   Expected: the library/page title changes from "Untitled meeting" to a descriptive title of ≤ 8 words, and the summary shows the Interview sections that have items.
2. On that meeting, click the title, type "Edited title", and press Enter. Then switch the template to **Standup**.
   Expected: the status goes summarizing → ready, Standup sections appear, and the title stays "Edited title".
3. **Old meeting (Review Focus 5):** open "Wildfire smoke interview" and check it renders with no page errors. Switch it to **Sales call**.
   Expected: after re-summarizing, Sales sections appear. Switch it back to General afterwards.
4. **Name rendering (Review Focus 3):** rename a speaker to `<b>x</b>`.
   Expected: the transcript shows the literal text `<b>x</b>`, not bold. Clear it afterwards.
5. `PATCH /api/meetings/<id>` with `{}` → `400`, and with `{"title":"   "}` → `400`.
6. At 375px width, `/new` (3 tabs, with the template select) has no horizontal scroll.

- [ ] **Step 7: Commit**

```bash
git add lib/templates.ts lib/titles.ts lib/summary-schema.ts lib/pipeline/summarize.ts lib/pipeline/advance.ts lib/summary-markdown.ts app/api/meetings/route.ts app/api/meetings/bot/route.ts 'app/api/meetings/[id]/route.ts' lib/client/media.ts components/template-select.tsx components/meeting-header.tsx components/uploader.tsx components/recorder.tsx components/bot-joiner.tsx components/summary-view.tsx components/meeting-view.tsx tests/templates.test.ts tests/titles.test.ts tests/summary-markdown.test.ts
git commit -m "feat: meeting templates and auto titles"
```

---

## Task 5: Delete meetings

**Files:**
- Modify: `app/api/meetings/[id]/route.ts`, `components/meeting-header.tsx`

**Interfaces:**
- Consumes: `leaveCall` (`lib/bot/recall.ts`), `del` (`@vercel/blob`), `MeetingHeader` (Task 4)
- Produces: `DELETE /api/meetings/:id` → `204` | `404`

- [ ] **Step 1: Reproduce the gap (RED).** With `npm run dev` running, upload a small meeting with the upload helper, then call the not-yet-existing endpoint:

`curl -s -X DELETE localhost:3000/api/meetings/<id> -o /dev/null -w '%{http_code}\n'`

Expected: `405` (no DELETE handler yet).

- [ ] **Step 2: Add the DELETE handler to `app/api/meetings/[id]/route.ts`**

```ts
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const meeting = await db.query.meetings.findFirst({
    where: eq(meetings.id, id),
    columns: { status: true, recallBotId: true, audioUrl: true },
  });
  if (!meeting) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (meeting.status === 'in_meeting' && meeting.recallBotId) {
    await leaveCall(meeting.recallBotId).catch((err) => console.error('Recall leaveCall on delete failed', id, err));
  }
  if (meeting.audioUrl) {
    await del(meeting.audioUrl).catch((err) => console.error('Blob delete failed', id, err));
  }
  // Utterances go with the row (ON DELETE CASCADE); background work for this meeting then updates nothing.
  await db.delete(meetings).where(eq(meetings.id, id));
  return new NextResponse(null, { status: 204 });
}
```

(Imports: `del` from `@vercel/blob`, `leaveCall` from `@/lib/bot/recall`.)

- [ ] **Step 3: Add Delete to `components/meeting-header.tsx`**

Import `Button` from `@/components/ui/button`. Inside the component, add:

```tsx
  const [deleting, setDeleting] = useState(false);
  async function remove() {
    if (!window.confirm('Delete this meeting? This removes the recording and transcript permanently.')) return;
    setDeleting(true);
    onError(null);
    const res = await fetch(`/api/meetings/${meeting.id}`, { method: 'DELETE' });
    if (res.ok) {
      router.push('/');
      router.refresh();
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    onError(data.error ?? 'Could not delete the meeting.');
    setDeleting(false);
  }
```

and after the `<TemplateSelect … />`:

```tsx
      <Button size="sm" variant="outline" className="ml-auto" onClick={remove} disabled={deleting}>
        {deleting ? 'Deleting…' : 'Delete'}
      </Button>
```

- [ ] **Step 4: Verify (GREEN)**

Run: `npx tsc --noEmit && npm test && npx eslint .` → clean. Then:
1. Repeat Step 1's curl on that meeting.
   Expected: `204`. Afterwards `GET /api/meetings/<id>` returns `404`, `curl -sI <its audio_url>` returns `404` (the blob is gone), and its utterance count is 0.
2. Delete again: `404`. `DELETE /api/meetings/not-a-uuid`: `404`.
3. In headless Chrome on another fresh upload, click Delete and accept the confirm.
   Expected: it redirects to `/` and the meeting is gone from the list. With the confirm dismissed, nothing happens.

- [ ] **Step 5: Delete during background work (Review Focus 2)**

On a ready meeting, `POST /resummarize` (→ 202) and then immediately `DELETE` (→ 204). Wait 60s.
Expected: `GET` still returns `404`, and the dev log shows no unhandled error. A bot meeting deleted while `in_meeting` is covered live in Task 6.

- [ ] **Step 6: Commit**

```bash
git add 'app/api/meetings/[id]/route.ts' components/meeting-header.tsx
git commit -m "feat: delete meetings with their recording and transcript"
```

---

## Task 6: Docs, deploy, live checks

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README.**
  - In "What it does", add: speakers can be renamed (bot meetings are named from Google Meet automatically), five summary templates, automatic titles, and delete.
  - In the Architecture section, add one short paragraph on `startResummarize` (the ready → summarizing claim shared by renames and template changes) and one on Recall speaker-timeline matching (50% overlap rule).
  - In "What I'd do next", remove anything now done.

- [ ] **Step 2: Verify and deploy**

```bash
npm test && npx tsc --noEmit && npx eslint . && npm run build
vercel deploy --prod --yes
```

Expected: all pass. The deployment is `READY`.

- [ ] **Step 3: Live checks on production** (needs the user for the bot run)
  1. **Bot names:** send the bot to the user's Meet from `/new` → "Join a meeting", with an empty title and the Standup template. The user admits it and talks, then Stop.
     Expected:
     - The transcript shows the user's Meet display name with no manual step.
     - The title becomes descriptive.
     - The Standup sections appear.
  2. **Delete while the bot is in the call:** send another bot. Once it's recording, click Delete.
     Expected: the bot leaves the Meet within seconds, and the meeting is gone from the library.
  3. `vercel logs --environment production --since 15m --status-code 5xx` shows no 5xx errors.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: README for speaker names, templates, auto titles and delete"
```
