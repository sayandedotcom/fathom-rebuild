# Fanthom Meeting Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a deployed, Fathom-like meeting assistant: upload meeting audio → diarized transcript → AI summary + action items → chat about the meeting → searchable meeting library.

**Architecture:** One Next.js 16 App Router app on Vercel. The browser uploads audio directly to Vercel Blob. AssemblyAI transcribes it with speaker labels. A single idempotent `advanceMeeting(id)`, triggered by the AssemblyAI webhook and by the page's status poll (both via `after()`), stores utterances and asks Claude for a structured summary. Chat streams answers with the full transcript in the prompt. Search is Postgres full-text search over utterances.

**Tech Stack:** Next.js 16.3, React 19, Tailwind 4 + shadcn/ui, AI SDK 7 (`ai`, `@ai-sdk/anthropic` 4, `@ai-sdk/react` 4), `@vercel/blob` 2.8, `assemblyai` 4.41, Drizzle ORM 0.45 + drizzle-kit 0.31 on Neon (`@neondatabase/serverless` 1.1), zod 4, vitest 5.

**Spec:** `docs/superpowers/specs/2026-09-28-meeting-assistant-design.md`

## Global Constraints

- 24h take-home. **Tasks 1–10 (P0) must be finished, deployed and pass the Task 10 gate before any P1 task (11–15) starts.** P2 (full vitest suite with mocked `advanceMeeting`, richer search, integrations) is out of scope for this plan.
- Never modify or delete `.claude/`, `.agent-logs/` or `CAPTURE-TEST.md` (agent-capture tooling). Never commit `.env*` files or audio files.
- Node 22; npm (lockfile `package-lock.json`).
- Model ID comes from `ANTHROPIC_MODEL`, default `claude-sonnet-5`, used only through `llm()` in `lib/llm.ts`.
- Upload limits: **500MB** (`MAX_UPLOAD_BYTES`), **2h** (`MAX_DURATION_SEC`), audio/* or video/* only, enforced on the client and in `onBeforeGenerateToken`.
- No auth. Chat history is not persisted.
- AI SDK 7 idioms only: `generateText` + `output: Output.object({ schema })` (not `generateObject`), `instructions` (not `system`), chat responses via `createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream }) })`, client `useChat({ transport: new DefaultChatTransport({ api }) })` + `sendMessage({ text })`.
- Next 16: `params` and `searchParams` are Promises and must be awaited.
- Timestamps shown to users and to the LLM use `formatTimestamp`: `mm:ss` under an hour, `h:mm:ss` from one hour.
- Deviations from the spec, deliberate: (1) `meetings.updatedAt` is added to detect a stuck `summarizing` state; (2) a few pure-function vitest tests are in P0 because they cost minutes and pin the Review Focus cases; (3) an AssemblyAI submit failure returns an error on the upload page instead of creating a `failed` meeting (no row is created without a transcript ID).

## Review Focus

1. **Audio with no speech (silence, music only).** AssemblyAI completes with `utterances` null or empty. Expected: the meeting becomes `ready` with "No speech was detected in this recording." and no LLM call. Pinned in Task 3 (`mapUtterances(null)`) and Task 6 (`summarizeMeeting` empty branch, manual check).
2. **Recordings of one hour or longer.** Timestamps must read `1:02:05`, not `62:05`, and seek correctly. Pinned in Task 3 (`formatTimestamp` tests).
3. **Malformed deep links (`?t=abc`, `?t=-5`, a non-UUID meeting ID).** Expected: `?t` is ignored and a bad ID gives a 404, not a 500. Pinned in Task 3 (`parseSeekParam` tests) and Task 6 (`isUuid` test).
4. **Search queries that are only stopwords or punctuation (`the`, `"`, `C++ &&`).** Expected: "No results", never a 500. Pinned in Task 9 (manual curl checks; `websearch_to_tsquery` never throws on user input).
5. **The webhook and the status poll arriving together, or a function dying mid-summary.** Expected: exactly one summary; a meeting stuck in `summarizing` for more than 6 minutes becomes `failed` with "Summarization timed out." Pinned in Task 6 (`isStaleSummarizing` tests + concurrent curl check).

---

## File Structure

```
app/
  layout.tsx                          (modify) app shell, header link to / and /new
  page.tsx                            (replace) library + search
  new/page.tsx                        upload page (P0); Record tab added in Task 13
  meetings/[id]/page.tsx              server loader → <MeetingView>
  api/blob/upload/route.ts            Blob client-upload token route
  api/meetings/route.ts               POST create meeting + submit to AssemblyAI
  api/meetings/[id]/route.ts          GET status; schedules advanceMeeting via after()
  api/meetings/[id]/chat/route.ts     POST streaming chat
  api/meetings/[id]/retry/route.ts    (P1) POST retry
  api/webhooks/assemblyai/route.ts    POST webhook → advanceMeeting via after()
components/
  uploader.tsx  meeting-view.tsx  summary-view.tsx  transcript-view.tsx  chat-panel.tsx
  search-results.tsx  recorder.tsx (P1)  status-stepper.tsx (P1)
  ui/*                                shadcn generated
lib/
  env.ts           requireEnv
  llm.ts           llm(), MODEL_ID
  limits.ts        MAX_UPLOAD_BYTES, MAX_DURATION_SEC, validateMediaFile
  ids.ts           isUuid
  summary-schema.ts summarySchema, Summary, EMPTY_SUMMARY
  db/schema.ts  db/index.ts
  transcript/format.ts   formatTimestamp, formatTranscript, parseSeekParam
  pipeline/map-utterances.ts  pipeline/stale.ts  pipeline/assemblyai.ts
  pipeline/prompts.ts  pipeline/summarize.ts  pipeline/advance.ts
  search/highlight.ts  search/search.ts
  client/media.ts        readDuration, defaultTitle, createMeeting (browser-only helpers)
  chat/citations.ts      (P1) parseCitations
tests/  *.test.ts        vitest, pure functions only
scripts/check-model.ts  scripts/db-check.ts
drizzle.config.ts  drizzle/ (generated migrations)  vitest.config.ts  README.md
```

---

## Task 0: Accounts and keys (human, before Task 1)

The executor cannot create these. Ask the user to do it and confirm before starting Task 1.

- [ ] **Step 1: Create or collect**
  - An AssemblyAI API key (assemblyai.com dashboard) → `ASSEMBLYAI_API_KEY`
  - An Anthropic API key (console.anthropic.com) → `ANTHROPIC_API_KEY`
  - A Vercel account; the Vercel CLI is logged in (`vercel whoami` prints the username)
- [ ] **Step 2: Get a two-speaker sample file** (not committed):

```bash
mkdir -p test-audio && curl -L -o test-audio/wildfires.mp3 https://assembly.ai/wildfires.mp3
```

---

## Task 1: Scaffold, verify the model, first deploy

**Files:**
- Create: the Next.js scaffold (`app/`, `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `public/`), `lib/env.ts`, `lib/llm.ts`, `scripts/check-model.ts`, `vitest.config.ts`, `components/ui/*`
- Modify: `.gitignore` (merge)

**Interfaces:**
- Produces: `requireEnv(name: string): string`; `llm(): LanguageModel`; `MODEL_ID: string`; `npm test` runs vitest.

- [ ] **Step 1: Scaffold into a sibling directory and merge it in** (the repo is not empty, so create-next-app refuses to run in place)

```bash
cd ~/Desktop
npx create-next-app@16 fanthom-scaffold --ts --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-npm --yes
cd fanthom-scaffold && rm -rf .git node_modules
cat .gitignore >> ../fanthom/.gitignore && rm .gitignore
cp -r . ../fanthom/ && cd .. && rm -rf fanthom-scaffold
cd fanthom && npm install
```

Then make sure `.gitignore` also has these lines (append any that are missing):

```
.env*
!.env.example
test-audio/
.vercel
```

- [ ] **Step 2: Install dependencies**

```bash
npm install ai@^7 @ai-sdk/anthropic@^4 @ai-sdk/react@^4 @vercel/blob@^2.8 assemblyai@^4.41 drizzle-orm@^0.45 @neondatabase/serverless@^1.1 zod@^4
npm install -D drizzle-kit@^0.31 vitest@^5 tsx dotenv
npx shadcn@latest init -d
npx shadcn@latest add button input card tabs badge progress scroll-area separator
```

- [ ] **Step 3: Add scripts to `package.json`** (keep the existing `dev`, `build`, `start`, `lint`):

```json
"test": "vitest run",
"db:generate": "drizzle-kit generate",
"db:migrate": "drizzle-kit migrate",
"check:model": "tsx --env-file=.env.local scripts/check-model.ts"
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
```

- [ ] **Step 5: Create `lib/env.ts`**

```ts
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}
```

- [ ] **Step 6: Create `lib/llm.ts`**

```ts
import { anthropic } from '@ai-sdk/anthropic';

export const MODEL_ID = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5';

export function llm() {
  return anthropic(MODEL_ID);
}
```

- [ ] **Step 7: Create `scripts/check-model.ts`**

```ts
import { generateText } from 'ai';
import { llm, MODEL_ID } from '../lib/llm';

async function main() {
  const { text } = await generateText({ model: llm(), prompt: 'Reply with exactly the word: ok' });
  console.log(`${MODEL_ID} -> ${text}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 8: Link Vercel, provision storage, write env**

The executor runs:

```bash
vercel link --yes
vercel integration add neon          # accept prompts; this sets DATABASE_URL on the project
vercel blob store add fanthom-audio  # connect it to the project when asked; this sets BLOB_READ_WRITE_TOKEN
SECRET=$(openssl rand -hex 24)
for env in production development; do
  printf '%s' "$SECRET" | vercel env add WEBHOOK_SECRET "$env"
  printf '%s' 'claude-sonnet-5' | vercel env add ANTHROPIC_MODEL "$env"
done
```

The API keys are the user's secrets, so **ask the user to run these themselves** (typing `!` before each command runs it in the Claude Code session; paste the key when prompted):

```bash
vercel env add ASSEMBLYAI_API_KEY production
vercel env add ASSEMBLYAI_API_KEY development
vercel env add ANTHROPIC_API_KEY production
vercel env add ANTHROPIC_API_KEY development
```

Then: `vercel env pull .env.local` (this pulls the development environment).

If `vercel integration add neon` or `vercel blob store add` is unavailable, do the same in the Vercel dashboard (Storage tab → create Neon Postgres, create Blob store, connect both to the project), then run `vercel env pull .env.local`. `APP_URL` is set in Step 10.

- [ ] **Step 9: Verify the model ID**

Run: `npm run check:model`
Expected: `claude-sonnet-5 -> ok`. If it errors with a not-found or invalid-model error, set `ANTHROPIC_MODEL` to a model ID listed in the Anthropic console, update the Vercel env, and rerun. Do not continue until this prints `ok`.

- [ ] **Step 10: Deploy and set APP_URL**

```bash
npm run build
vercel deploy --prod
```

Take the production URL printed (e.g. `https://fanthom-xxx.vercel.app`), then:

```bash
printf '%s' 'https://<production-host>' | vercel env add APP_URL production   # substitute the real host
vercel deploy --prod                                                          # redeploy so APP_URL takes effect
```

Expected: the build succeeds and the production URL shows the default Next.js page. Leave `APP_URL` unset in development (no webhook on localhost).

- [ ] **Step 11: Commit**

```bash
git add .gitignore package.json package-lock.json tsconfig.json next.config.ts postcss.config.mjs eslint.config.mjs components.json app components lib public scripts vitest.config.ts
git status --short   # confirm no .env*, .vercel or test-audio files are staged
git commit -m "chore: scaffold Next.js app with AI SDK, Blob, AssemblyAI, Drizzle"
```

---

## Task 2: Database schema and migration

**Files:**
- Create: `lib/summary-schema.ts`, `lib/db/schema.ts`, `lib/db/index.ts`, `drizzle.config.ts`, `scripts/db-check.ts`, `drizzle/*` (generated)

**Interfaces:**
- Consumes: `requireEnv` (Task 1)
- Produces: `db` (Drizzle, with `db.query.meetings`); tables `meetings`, `utterances`; types `Meeting`, `Utterance`, `NewUtterance`, `MeetingStatus`; `summarySchema`, `Summary`, `EMPTY_SUMMARY`

- [ ] **Step 1: Create `lib/summary-schema.ts`**

```ts
import { z } from 'zod';

export const summarySchema = z.object({
  overview: z.string().describe('2-4 sentence overview of what the meeting was about and its outcome'),
  keyPoints: z.array(z.string()).describe('Most important points discussed, one sentence each'),
  decisions: z.array(z.string()).describe('Decisions that were explicitly agreed; empty if none'),
  actionItems: z
    .array(
      z.object({
        task: z.string(),
        owner: z.string().nullable().describe('Person responsible if stated or clearly implied, else null'),
        due: z.string().nullable().describe('Deadline as stated in the meeting, else null'),
      }),
    )
    .describe('Concrete follow-up tasks; empty if none'),
});

export type Summary = z.infer<typeof summarySchema>;

export const EMPTY_SUMMARY: Summary = {
  overview: 'No speech was detected in this recording.',
  keyPoints: [],
  decisions: [],
  actionItems: [],
};
```

- [ ] **Step 2: Create `lib/db/schema.ts`**

```ts
import { sql } from 'drizzle-orm';
import { customType, index, integer, jsonb, pgEnum, pgTable, serial, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { Summary } from '../summary-schema';

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

export const meetingStatus = pgEnum('meeting_status', ['transcribing', 'summarizing', 'ready', 'failed']);

export const meetings = pgTable('meetings', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  audioUrl: text('audio_url').notNull(),
  durationSec: integer('duration_sec'),
  status: meetingStatus('status').notNull().default('transcribing'),
  error: text('error'),
  assemblyaiId: text('assemblyai_id').notNull().unique(),
  summary: jsonb('summary').$type<Summary>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const utterances = pgTable(
  'utterances',
  {
    id: serial('id').primaryKey(),
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    speaker: text('speaker').notNull(),
    startMs: integer('start_ms').notNull(),
    endMs: integer('end_ms').notNull(),
    text: text('text').notNull(),
    tsv: tsvector('tsv').generatedAlwaysAs(sql`to_tsvector('english', text)`),
  },
  (t) => [
    index('utterances_tsv_idx').using('gin', t.tsv),
    index('utterances_meeting_start_idx').on(t.meetingId, t.startMs),
  ],
);

export type Meeting = typeof meetings.$inferSelect;
export type MeetingStatus = Meeting['status'];
export type Utterance = typeof utterances.$inferSelect;
export type NewUtterance = typeof utterances.$inferInsert;
```

- [ ] **Step 3: Create `lib/db/index.ts`**

```ts
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { requireEnv } from '../env';
import * as schema from './schema';

export const db = drizzle(neon(requireEnv('DATABASE_URL')), { schema });
```

- [ ] **Step 4: Create `drizzle.config.ts`**

```ts
import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

config({ path: '.env.local' });

export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

- [ ] **Step 5: Generate and apply the migration**

Run: `npm run db:generate && npm run db:migrate`
Expected: a SQL file in `drizzle/` containing `CREATE TYPE "public"."meeting_status"`, `"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', text)) STORED` and `USING gin`; the migrate command reports success.

- [ ] **Step 6: Create `scripts/db-check.ts`** (proves the generated tsvector column and FTS work)

```ts
import { eq, sql } from 'drizzle-orm';
import { db } from '../lib/db';
import { meetings, utterances } from '../lib/db/schema';

async function main() {
  const [m] = await db
    .insert(meetings)
    .values({ title: 'db-check', audioUrl: 'https://example.com/a.mp3', assemblyaiId: `db-check-${Date.now()}` })
    .returning();
  await db.insert(utterances).values({ meetingId: m.id, speaker: 'A', startMs: 0, endMs: 1000, text: 'We decided to ship pricing on Friday' });
  const hits = await db.execute(
    sql`select text from utterances where meeting_id = ${m.id} and tsv @@ websearch_to_tsquery('english', 'pricing decision')`,
  );
  await db.delete(meetings).where(eq(meetings.id, m.id));
  console.log(hits.rows.length === 1 ? 'FTS OK' : `FTS FAILED: ${JSON.stringify(hits.rows)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 7: Run it**

Run: `npx tsx --env-file=.env.local scripts/db-check.ts`
Expected: `FTS OK` (stemming matches "decided" to "decision").

- [ ] **Step 8: Commit**

```bash
git add lib/summary-schema.ts lib/db drizzle.config.ts drizzle scripts/db-check.ts
git commit -m "feat: add meetings/utterances schema with full-text search column"
```

---

## Task 3: Pure transcript utilities

**Files:**
- Create: `lib/transcript/format.ts`, `lib/pipeline/map-utterances.ts`, `lib/pipeline/stale.ts`, `lib/limits.ts`
- Test: `tests/format.test.ts`, `tests/map-utterances.test.ts`, `tests/stale.test.ts`, `tests/limits.test.ts`

**Interfaces:**
- Consumes: `NewUtterance` (Task 2)
- Produces:
  - `formatTimestamp(ms: number): string`
  - `type TranscriptLine = { speaker: string; startMs: number; text: string }`
  - `formatTranscript(lines: TranscriptLine[]): string`
  - `parseSeekParam(t: string | string[] | undefined): number | null`
  - `type RawUtterance = { speaker: string; start: number; end: number; text: string }`
  - `mapUtterances(meetingId: string, input: RawUtterance[] | null | undefined): NewUtterance[]`
  - `SUMMARIZING_TIMEOUT_MS`, `isStaleSummarizing(status: string, updatedAt: Date, now: Date): boolean`
  - `MAX_UPLOAD_BYTES`, `MAX_DURATION_SEC`, `validateMediaFile(file: { type: string; size: number }): string | null`

- [ ] **Step 1: Write the failing tests**

`tests/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatTimestamp, formatTranscript, parseSeekParam } from '../lib/transcript/format';

describe('formatTimestamp', () => {
  it('pads minutes and seconds under an hour', () => {
    expect(formatTimestamp(0)).toBe('00:00');
    expect(formatTimestamp(65_000)).toBe('01:05');
    expect(formatTimestamp(59_999)).toBe('00:59');
  });
  it('uses h:mm:ss from one hour', () => {
    expect(formatTimestamp(3_600_000)).toBe('1:00:00');
    expect(formatTimestamp(3_725_000)).toBe('1:02:05');
  });
});

describe('formatTranscript', () => {
  it('renders one line per utterance', () => {
    expect(
      formatTranscript([
        { speaker: 'A', startMs: 0, text: 'Hi all.' },
        { speaker: 'B', startMs: 65_000, text: 'Pricing next.' },
      ]),
    ).toBe('[00:00] Speaker A: Hi all.\n[01:05] Speaker B: Pricing next.');
  });
});

describe('parseSeekParam', () => {
  it('accepts non-negative integer milliseconds', () => {
    expect(parseSeekParam('0')).toBe(0);
    expect(parseSeekParam('65000')).toBe(65000);
  });
  it('rejects anything else', () => {
    expect(parseSeekParam(undefined)).toBeNull();
    expect(parseSeekParam('abc')).toBeNull();
    expect(parseSeekParam('-5')).toBeNull();
    expect(parseSeekParam('1.5')).toBeNull();
    expect(parseSeekParam(['1', '2'])).toBeNull();
  });
});
```

`tests/map-utterances.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mapUtterances } from '../lib/pipeline/map-utterances';

describe('mapUtterances', () => {
  it('maps AssemblyAI utterances to rows', () => {
    expect(mapUtterances('m1', [{ speaker: 'A', start: 120.4, end: 2300.6, text: ' Hello there. ' }])).toEqual([
      { meetingId: 'm1', speaker: 'A', startMs: 120, endMs: 2301, text: 'Hello there.' },
    ]);
  });
  it('returns [] for null, undefined or empty input (no speech)', () => {
    expect(mapUtterances('m1', null)).toEqual([]);
    expect(mapUtterances('m1', undefined)).toEqual([]);
    expect(mapUtterances('m1', [])).toEqual([]);
  });
  it('drops blank utterances', () => {
    expect(mapUtterances('m1', [{ speaker: 'A', start: 0, end: 10, text: '   ' }])).toEqual([]);
  });
});
```

`tests/stale.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isStaleSummarizing, SUMMARIZING_TIMEOUT_MS } from '../lib/pipeline/stale';

const now = new Date('2026-09-28T12:00:00Z');

describe('isStaleSummarizing', () => {
  it('is stale when summarizing longer than the timeout', () => {
    expect(isStaleSummarizing('summarizing', new Date(now.getTime() - SUMMARIZING_TIMEOUT_MS - 1), now)).toBe(true);
  });
  it('is not stale within the timeout', () => {
    expect(isStaleSummarizing('summarizing', new Date(now.getTime() - 1000), now)).toBe(false);
  });
  it('only applies to summarizing', () => {
    expect(isStaleSummarizing('transcribing', new Date(0), now)).toBe(false);
    expect(isStaleSummarizing('ready', new Date(0), now)).toBe(false);
  });
});
```

`tests/limits.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MAX_UPLOAD_BYTES, validateMediaFile } from '../lib/limits';

describe('validateMediaFile', () => {
  it('accepts audio and video under the limit', () => {
    expect(validateMediaFile({ type: 'audio/mpeg', size: 1000 })).toBeNull();
    expect(validateMediaFile({ type: 'video/mp4', size: MAX_UPLOAD_BYTES })).toBeNull();
    expect(validateMediaFile({ type: 'audio/webm;codecs=opus', size: 1 })).toBeNull();
  });
  it('rejects other types, empty type, empty and oversized files', () => {
    expect(validateMediaFile({ type: 'text/plain', size: 10 })).toMatch(/audio or video/);
    expect(validateMediaFile({ type: '', size: 10 })).toMatch(/audio or video/);
    expect(validateMediaFile({ type: 'audio/mpeg', size: 0 })).toMatch(/empty/);
    expect(validateMediaFile({ type: 'audio/mpeg', size: MAX_UPLOAD_BYTES + 1 })).toMatch(/500MB/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL, the modules cannot be resolved.

- [ ] **Step 3: Implement `lib/transcript/format.ts`**

```ts
export type TranscriptLine = { speaker: string; startMs: number; text: string };

const pad = (n: number) => String(n).padStart(2, '0');

export function formatTimestamp(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function formatTranscript(lines: TranscriptLine[]): string {
  return lines.map((l) => `[${formatTimestamp(l.startMs)}] Speaker ${l.speaker}: ${l.text}`).join('\n');
}

export function parseSeekParam(t: string | string[] | undefined): number | null {
  if (typeof t !== 'string' || !/^\d+$/.test(t)) return null;
  return Number(t);
}
```

- [ ] **Step 4: Implement `lib/pipeline/map-utterances.ts`**

```ts
import type { NewUtterance } from '../db/schema';

export type RawUtterance = { speaker: string; start: number; end: number; text: string };

export function mapUtterances(meetingId: string, input: RawUtterance[] | null | undefined): NewUtterance[] {
  return (input ?? [])
    .filter((u) => u.text.trim() !== '')
    .map((u) => ({
      meetingId,
      speaker: u.speaker,
      startMs: Math.round(u.start),
      endMs: Math.round(u.end),
      text: u.text.trim(),
    }));
}
```

- [ ] **Step 5: Implement `lib/pipeline/stale.ts`** (the timeout exceeds the 300s `maxDuration` of the routes that summarize)

```ts
export const SUMMARIZING_TIMEOUT_MS = 6 * 60 * 1000;

export function isStaleSummarizing(status: string, updatedAt: Date, now: Date): boolean {
  return status === 'summarizing' && now.getTime() - updatedAt.getTime() > SUMMARIZING_TIMEOUT_MS;
}
```

- [ ] **Step 6: Implement `lib/limits.ts`**

```ts
export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
export const MAX_DURATION_SEC = 2 * 60 * 60;

export function validateMediaFile(file: { type: string; size: number }): string | null {
  if (!/^(audio|video)\//.test(file.type)) return 'Please choose an audio or video file.';
  if (file.size === 0) return 'That file is empty.';
  if (file.size > MAX_UPLOAD_BYTES) return 'Files larger than 500MB are not supported.';
  return null;
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, 4 files.

- [ ] **Step 8: Commit**

```bash
git add lib/transcript lib/pipeline/map-utterances.ts lib/pipeline/stale.ts lib/limits.ts tests
git commit -m "feat: add transcript formatting, utterance mapping, limits and stale detection"
```

---

## Task 4: AssemblyAI client, prompts and summarizer

**Files:**
- Create: `lib/pipeline/assemblyai.ts`, `lib/pipeline/prompts.ts`, `lib/pipeline/summarize.ts`, `scripts/check-pipeline.ts`

**Interfaces:**
- Consumes: `requireEnv`, `llm` (Task 1); `summarySchema`, `Summary` (Task 2); `formatTranscript`, `mapUtterances` (Task 3)
- Produces:
  - `submitTranscription(audioUrl: string): Promise<string>` (returns the AssemblyAI transcript ID)
  - `getTranscription(id: string): Promise<Transcript>` (from `assemblyai`; fields used: `status`, `error`, `utterances`, `audio_duration`)
  - `SUMMARY_INSTRUCTIONS: string`, `chatInstructions(title: string, transcript: string): string`
  - `summarize(transcript: string): Promise<Summary>` (retries once on `NoObjectGeneratedError`)

- [ ] **Step 1: Create `lib/pipeline/assemblyai.ts`**

```ts
import { AssemblyAI } from 'assemblyai';
import { requireEnv } from '../env';

function client() {
  return new AssemblyAI({ apiKey: requireEnv('ASSEMBLYAI_API_KEY') });
}

function webhookUrl(): string | undefined {
  const appUrl = process.env.APP_URL;
  if (!appUrl?.startsWith('https://')) return undefined;
  return `${appUrl}/api/webhooks/assemblyai?secret=${encodeURIComponent(requireEnv('WEBHOOK_SECRET'))}`;
}

export async function submitTranscription(audioUrl: string): Promise<string> {
  const transcript = await client().transcripts.submit({
    audio: audioUrl,
    speech_models: ['universal-3-5-pro', 'universal-2'],
    language_detection: true,
    speaker_labels: true,
    webhook_url: webhookUrl(),
  });
  return transcript.id;
}

export async function getTranscription(id: string) {
  return client().transcripts.get(id);
}
```

- [ ] **Step 2: Create `lib/pipeline/prompts.ts`**

```ts
export const SUMMARY_INSTRUCTIONS = `You summarize meeting transcripts for the people who attended.
The transcript lines look like "[mm:ss] Speaker A: text". Speakers are anonymous letters; if participants address each other by name, use those names for owners, otherwise use "Speaker A" etc.
Be specific and factual. Only include decisions and action items that are actually in the transcript. Never invent owners or deadlines.`;

export function chatInstructions(title: string, transcript: string): string {
  return `You answer questions about the meeting "${title}" using only its transcript below.
Each transcript line starts with a [mm:ss] or [h:mm:ss] timestamp and a speaker label.
When you state something from the meeting, cite the timestamp of the supporting line in square brackets exactly as written, e.g. [12:04].
If the transcript does not contain the answer, say so plainly. Keep answers short.

<transcript>
${transcript}
</transcript>`;
}
```

- [ ] **Step 3: Create `lib/pipeline/summarize.ts`**

```ts
import { generateText, NoObjectGeneratedError, Output } from 'ai';
import { llm } from '../llm';
import { type Summary, summarySchema } from '../summary-schema';
import { SUMMARY_INSTRUCTIONS } from './prompts';

export async function summarize(transcript: string): Promise<Summary> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { output } = await generateText({
        model: llm(),
        instructions: SUMMARY_INSTRUCTIONS,
        prompt: transcript,
        output: Output.object({ schema: summarySchema }),
      });
      return output;
    } catch (err) {
      if (!NoObjectGeneratedError.isInstance(err)) throw err;
      lastError = err;
    }
  }
  throw lastError;
}
```

- [ ] **Step 4: Create `scripts/check-pipeline.ts`** (a real end-to-end check of both external services, without the DB)

```ts
import { getTranscription, submitTranscription } from '../lib/pipeline/assemblyai';
import { mapUtterances } from '../lib/pipeline/map-utterances';
import { summarize } from '../lib/pipeline/summarize';
import { formatTranscript } from '../lib/transcript/format';

async function main() {
  const id = await submitTranscription('https://assembly.ai/wildfires.mp3');
  console.log('submitted', id);
  let t = await getTranscription(id);
  while (t.status === 'queued' || t.status === 'processing') {
    await new Promise((r) => setTimeout(r, 3000));
    t = await getTranscription(id);
  }
  if (t.status === 'error') throw new Error(t.error);
  const rows = mapUtterances('check', t.utterances);
  console.log('speakers', new Set(rows.map((r) => r.speaker)));
  console.log(JSON.stringify(await summarize(formatTranscript(rows)), null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 5: Run it**

Run: `npx tsx --env-file=.env.local scripts/check-pipeline.ts`
Expected, within about 1–2 minutes: `speakers Set(2) { 'A', 'B' }`, then a JSON summary with a non-empty `overview` and `keyPoints`.

- [ ] **Step 6: Commit**

```bash
git add lib/pipeline/assemblyai.ts lib/pipeline/prompts.ts lib/pipeline/summarize.ts scripts/check-pipeline.ts
git commit -m "feat: add AssemblyAI client and Claude structured summarizer"
```

---

## Task 5: Upload flow (Blob → create meeting → submit)

**Files:**
- Create: `app/api/blob/upload/route.ts`, `app/api/meetings/route.ts`, `lib/client/media.ts`, `components/uploader.tsx`, `app/new/page.tsx`
- Modify: `app/layout.tsx`

**Interfaces:**
- Consumes: `MAX_UPLOAD_BYTES`, `MAX_DURATION_SEC`, `validateMediaFile` (Task 3); `submitTranscription` (Task 4); `db`, `meetings` (Task 2)
- Produces:
  - `POST /api/meetings` with body `{ title: string; audioUrl: string; durationSec: number | null }` → `201 { id }` | `400 { error }` | `502 { error }`
  - `readDuration(file: Blob): Promise<number | null>`, `defaultTitle(): string`, `createMeeting(input): Promise<string>` in `lib/client/media.ts` (reused by the recorder in Task 13)

- [ ] **Step 1: Create `app/api/blob/upload/route.ts`**

```ts
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';
import { MAX_UPLOAD_BYTES } from '@/lib/limits';

export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ['audio/*', 'video/*'],
        maximumSizeInBytes: MAX_UPLOAD_BYTES,
        addRandomSuffix: true,
      }),
    });
    return NextResponse.json(json);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Upload rejected' }, { status: 400 });
  }
}
```

- [ ] **Step 2: Create `app/api/meetings/route.ts`** (only Vercel Blob URLs are accepted, so the endpoint cannot be used to make AssemblyAI fetch arbitrary URLs)

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { meetings } from '@/lib/db/schema';
import { MAX_DURATION_SEC } from '@/lib/limits';
import { submitTranscription } from '@/lib/pipeline/assemblyai';

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  audioUrl: z.url().refine((u) => {
    const url = new URL(u);
    return url.protocol === 'https:' && url.hostname.endsWith('.blob.vercel-storage.com');
  }, 'audioUrl must be a Vercel Blob URL'),
  durationSec: z.number().int().nonnegative().max(MAX_DURATION_SEC).nullable(),
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
    .values({ ...parsed.data, assemblyaiId })
    .returning({ id: meetings.id });
  return NextResponse.json({ id: meeting.id }, { status: 201 });
}
```

- [ ] **Step 3: Create `lib/client/media.ts`**

```ts
export function defaultTitle(): string {
  return `Meeting — ${new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
}

export function readDuration(file: Blob): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const media = document.createElement('video');
    media.preload = 'metadata';
    media.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(media.duration) ? Math.round(media.duration) : null);
    };
    media.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    media.src = url;
  });
}

export async function createMeeting(input: { title: string; audioUrl: string; durationSec: number | null }): Promise<string> {
  const res = await fetch('/api/meetings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = (await res.json()) as { id?: string; error?: string };
  if (!res.ok || !data.id) throw new Error(data.error ?? 'Could not create meeting');
  return data.id;
}
```

- [ ] **Step 4: Create `components/uploader.tsx`**

```tsx
'use client';

import { upload } from '@vercel/blob/client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { createMeeting, defaultTitle, readDuration } from '@/lib/client/media';
import { MAX_DURATION_SEC, validateMediaFile } from '@/lib/limits';

const MULTIPART_THRESHOLD = 50 * 1024 * 1024;

export function Uploader() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState(''); // empty avoids a server/client locale hydration mismatch; defaultTitle() applies on submit
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = progress !== null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setError(null);
    const invalid = validateMediaFile(file);
    if (invalid) return setError(invalid);
    try {
      const durationSec = await readDuration(file);
      if (durationSec !== null && durationSec > MAX_DURATION_SEC) {
        return setError('Recordings longer than 2 hours are not supported.');
      }
      setProgress(0);
      const blob = await upload(`meetings/${file.name}`, file, {
        access: 'public',
        handleUploadUrl: '/api/blob/upload',
        multipart: file.size > MULTIPART_THRESHOLD,
        onUploadProgress: (p) => setProgress(p.percentage),
      });
      const id = await createMeeting({ title: title.trim() || defaultTitle(), audioUrl: blob.url, durationSec });
      router.push(`/meetings/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setProgress(null);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Meeting title (optional)" disabled={busy} />
      <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 text-sm text-muted-foreground hover:bg-muted/50">
        <input
          type="file"
          accept="audio/*,video/*"
          className="sr-only"
          disabled={busy}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        {file ? `${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)` : 'Choose an audio or video file (max 500MB, 2h)'}
      </label>
      {progress !== null && <Progress value={progress} />}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={!file || busy}>
        {busy ? 'Uploading…' : 'Upload and transcribe'}
      </Button>
    </form>
  );
}
```

- [ ] **Step 5: Create `app/new/page.tsx`**

```tsx
import { Uploader } from '@/components/uploader';

export default function NewMeetingPage() {
  return (
    <main className="mx-auto max-w-xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">New meeting</h1>
      <Uploader />
    </main>
  );
}
```

- [ ] **Step 6: Modify `app/layout.tsx`**: keep the generated fonts and `<html>`/`<body>`, set the metadata and add a header above `{children}`:

```tsx
import Link from 'next/link';
// ...existing imports

export const metadata: Metadata = {
  title: 'Fanthom',
  description: 'AI meeting notes: transcript, summary, action items and Q&A',
};

// inside <body>, before {children}:
<header className="border-b">
  <nav className="mx-auto flex max-w-6xl items-center justify-between p-4">
    <Link href="/" className="font-semibold">Fanthom</Link>
    <Link href="/new" className="text-sm font-medium underline-offset-4 hover:underline">New meeting</Link>
  </nav>
</header>
```

- [ ] **Step 7: Verify manually**

Run: `npm run dev`, open `http://localhost:3000/new`, upload `test-audio/wildfires.mp3`.
Expected: the progress bar fills, then the browser navigates to `/meetings/<uuid>` (a 404 page for now, because the page arrives in Task 7). Then check the row:

```bash
npx tsx --env-file=.env.local -e "import('./lib/db').then(async ({db})=>{console.log(await db.query.meetings.findMany({columns:{id:true,status:true,assemblyaiId:true}}))})"
```

Expected: one row with `status: 'transcribing'` and a non-empty `assemblyaiId`. Also choose a `.txt` file and check the inline "Please choose an audio or video file." error.

- [ ] **Step 8: Commit**

```bash
git add app/api/blob app/api/meetings/route.ts lib/client components/uploader.tsx app/new app/layout.tsx
git commit -m "feat: upload audio to Blob and start AssemblyAI transcription"
```

---

## Task 6: Processing pipeline (advanceMeeting, status route, webhook)

**Files:**
- Create: `lib/ids.ts`, `lib/pipeline/advance.ts`, `app/api/meetings/[id]/route.ts`, `app/api/webhooks/assemblyai/route.ts`
- Test: `tests/ids.test.ts`

**Interfaces:**
- Consumes: Tasks 2–4 (`db`, schema, `mapUtterances`, `isStaleSummarizing`, `getTranscription`, `summarize`, `formatTranscript`, `EMPTY_SUMMARY`)
- Produces:
  - `isUuid(s: string): boolean`
  - `advanceMeeting(id: string): Promise<void>` (idempotent and safe to call concurrently)
  - `summarizeMeeting(id: string): Promise<void>` (reads utterances, sets `ready` or `failed`; reused by Retry in Task 12)
  - `GET /api/meetings/:id` → `{ status: MeetingStatus; error: string | null }` | 404

- [ ] **Step 1: Write the failing test** `tests/ids.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { isUuid } from '../lib/ids';

describe('isUuid', () => {
  it('accepts a v4 uuid', () => expect(isUuid('3f1c2a9e-6b1d-4c1e-9a7b-2d4e5f6a7b8c')).toBe(true));
  it('rejects junk', () => {
    expect(isUuid('abc')).toBe(false);
    expect(isUuid("1' or 1=1")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- tests/ids.test.ts`
Expected: FAIL, the module is not found.

- [ ] **Step 3: Implement `lib/ids.ts`**

```ts
import { z } from 'zod';

const uuid = z.uuid();

export function isUuid(s: string): boolean {
  return uuid.safeParse(s).success;
}
```

Run: `npm test -- tests/ids.test.ts`, expected PASS.

- [ ] **Step 4: Implement `lib/pipeline/advance.ts`**

```ts
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db';
import { meetings, utterances } from '../db/schema';
import { EMPTY_SUMMARY } from '../summary-schema';
import { formatTranscript } from '../transcript/format';
import { getTranscription } from './assemblyai';
import { mapUtterances } from './map-utterances';
import { isStaleSummarizing } from './stale';
import { summarize } from './summarize';

const INSERT_CHUNK = 500;

export async function advanceMeeting(id: string): Promise<void> {
  const meeting = await db.query.meetings.findFirst({ where: eq(meetings.id, id) });
  if (!meeting) return;

  if (isStaleSummarizing(meeting.status, meeting.updatedAt, new Date())) {
    await db
      .update(meetings)
      .set({ status: 'failed', error: 'Summarization timed out.' })
      .where(and(eq(meetings.id, id), eq(meetings.status, 'summarizing')));
    return;
  }
  if (meeting.status !== 'transcribing') return;

  const transcript = await getTranscription(meeting.assemblyaiId);
  if (transcript.status === 'queued' || transcript.status === 'processing') return;
  if (transcript.status === 'error') {
    await db
      .update(meetings)
      .set({ status: 'failed', error: `Transcription failed: ${transcript.error ?? 'unknown error'}` })
      .where(and(eq(meetings.id, id), eq(meetings.status, 'transcribing')));
    return;
  }

  // Webhook and poll can both get here; only the caller whose UPDATE matches proceeds.
  const claimed = await db
    .update(meetings)
    .set({
      status: 'summarizing',
      durationSec: transcript.audio_duration ? Math.round(transcript.audio_duration) : meeting.durationSec,
    })
    .where(and(eq(meetings.id, id), eq(meetings.status, 'transcribing')))
    .returning({ id: meetings.id });
  if (claimed.length === 0) return;

  const rows = mapUtterances(id, transcript.utterances);
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    await db.insert(utterances).values(rows.slice(i, i + INSERT_CHUNK));
  }
  await summarizeMeeting(id);
}

export async function summarizeMeeting(id: string): Promise<void> {
  const lines = await db
    .select({ speaker: utterances.speaker, startMs: utterances.startMs, text: utterances.text })
    .from(utterances)
    .where(eq(utterances.meetingId, id))
    .orderBy(asc(utterances.startMs));
  try {
    const summary = lines.length === 0 ? EMPTY_SUMMARY : await summarize(formatTranscript(lines));
    await db.update(meetings).set({ status: 'ready', summary, error: null }).where(eq(meetings.id, id));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(meetings).set({ status: 'failed', error: `Summary failed: ${message}` }).where(eq(meetings.id, id));
  }
}
```

- [ ] **Step 5: Create `app/api/meetings/[id]/route.ts`**

```ts
import { eq } from 'drizzle-orm';
import { after, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { meetings } from '@/lib/db/schema';
import { isUuid } from '@/lib/ids';
import { advanceMeeting } from '@/lib/pipeline/advance';

export const maxDuration = 300;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const meeting = await db.query.meetings.findFirst({
    where: eq(meetings.id, id),
    columns: { status: true, error: true },
  });
  if (!meeting) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (meeting.status === 'transcribing' || meeting.status === 'summarizing') {
    after(() => advanceMeeting(id));
  }
  return NextResponse.json(meeting, { headers: { 'cache-control': 'no-store' } });
}
```

- [ ] **Step 6: Create `app/api/webhooks/assemblyai/route.ts`** (AssemblyAI expects a fast 2xx, so the work runs in `after()`)

```ts
import { eq } from 'drizzle-orm';
import { after, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { meetings } from '@/lib/db/schema';
import { requireEnv } from '@/lib/env';
import { advanceMeeting } from '@/lib/pipeline/advance';

export const maxDuration = 300;

export async function POST(req: Request) {
  const secret = new URL(req.url).searchParams.get('secret');
  if (secret !== requireEnv('WEBHOOK_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as { transcript_id?: string } | null;
  if (!body?.transcript_id) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  const meeting = await db.query.meetings.findFirst({
    where: eq(meetings.assemblyaiId, body.transcript_id),
    columns: { id: true },
  });
  if (meeting) after(() => advanceMeeting(meeting.id));
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 7: Verify locally (poll path + concurrency)**

With `npm run dev` running and the meeting from Task 5 (`ID=<uuid>`):

```bash
curl -s localhost:3000/api/meetings/not-a-uuid -o /dev/null -w '%{http_code}\n'      # 404
curl -s localhost:3000/api/meetings/$ID & curl -s localhost:3000/api/meetings/$ID & wait # two concurrent triggers
# repeat every few seconds until ready:
curl -s localhost:3000/api/meetings/$ID
```

Expected: the first line prints `404`; the status goes `transcribing` → `summarizing` → `ready` within about 2 minutes. Then check exactly one set of utterances was inserted (the atomic claim held):

```bash
npx tsx --env-file=.env.local -e "import('./lib/db').then(async ({db})=>{const r=await db.execute(\`select count(*)::int n, count(distinct start_ms)::int d from utterances where meeting_id='$ID'\`);console.log(r.rows)})"
```

Expected: `n` equals `d` (no duplicated utterances).

Webhook secret check: `curl -s -X POST 'localhost:3000/api/webhooks/assemblyai?secret=wrong' -d '{}' -o /dev/null -w '%{http_code}\n'` prints `401`.

No-speech check (Review Focus 1): make a silent file with `ffmpeg -f lavfi -i anullsrc=r=16000:cl=mono -t 10 test-audio/silence.mp3` (skip if ffmpeg is missing and note it), upload it, poll. Expected: `ready`, and the summary overview is "No speech was detected in this recording." (If AssemblyAI instead returns `status: error` for silence, the meeting is `failed` with that message; that is also acceptable. Record which one happened in the README trade-offs.)

- [ ] **Step 8: Commit**

```bash
git add lib/ids.ts lib/pipeline/advance.ts app/api/meetings/\[id\]/route.ts app/api/webhooks tests/ids.test.ts
git commit -m "feat: idempotent meeting pipeline driven by webhook and status poll"
```

---

## Task 7: Meeting page (summary, transcript, audio seek)

**Files:**
- Create: `app/meetings/[id]/page.tsx`, `components/meeting-view.tsx`, `components/summary-view.tsx`, `components/transcript-view.tsx`

**Interfaces:**
- Consumes: `isUuid`, `parseSeekParam`, `formatTimestamp`, `db`, schema, `Summary`, `MeetingStatus`
- Produces:
  - `type MeetingViewProps = { meeting: { id; title; status: MeetingStatus; error: string | null; audioUrl; durationSec: number | null; createdAt: string; summary: Summary | null }; lines: { id: number; speaker: string; startMs: number; text: string }[]; initialSeekMs: number | null }`
  - `MeetingView` exposes `seek(ms)` to children through props. `ChatPanel` (Task 8) is rendered inside it and receives `onSeek` in Task 11.

- [ ] **Step 1: Create `app/meetings/[id]/page.tsx`**

```tsx
import { asc, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { MeetingView } from '@/components/meeting-view';
import { db } from '@/lib/db';
import { meetings, utterances } from '@/lib/db/schema';
import { isUuid } from '@/lib/ids';
import { parseSeekParam } from '@/lib/transcript/format';

export default async function MeetingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string | string[] }>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const meeting = await db.query.meetings.findFirst({ where: eq(meetings.id, id) });
  if (!meeting) notFound();
  const lines = await db
    .select({ id: utterances.id, speaker: utterances.speaker, startMs: utterances.startMs, text: utterances.text })
    .from(utterances)
    .where(eq(utterances.meetingId, id))
    .orderBy(asc(utterances.startMs));
  const { t } = await searchParams;

  return (
    <MeetingView
      meeting={{
        id: meeting.id,
        title: meeting.title,
        status: meeting.status,
        error: meeting.error,
        audioUrl: meeting.audioUrl,
        durationSec: meeting.durationSec,
        createdAt: meeting.createdAt.toISOString(),
        summary: meeting.summary,
      }}
      lines={lines}
      initialSeekMs={parseSeekParam(t)}
    />
  );
}
```

- [ ] **Step 2: Create `components/summary-view.tsx`**

```tsx
import type { Summary } from '@/lib/summary-schema';

export function SummaryView({ summary }: { summary: Summary }) {
  return (
    <div className="space-y-5 text-sm">
      <p className="leading-relaxed">{summary.overview}</p>
      <Section title="Action items">
        {summary.actionItems.length === 0 ? (
          <p className="text-muted-foreground">No action items.</p>
        ) : (
          <ul className="space-y-2">
            {summary.actionItems.map((a, i) => (
              <li key={i} className="flex gap-2">
                <input type="checkbox" className="mt-1" aria-label={a.task} />
                <span>
                  {a.task}
                  {(a.owner || a.due) && (
                    <span className="text-muted-foreground"> — {[a.owner, a.due].filter(Boolean).join(', ')}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Key points">
        <ul className="list-disc space-y-1 pl-5">{summary.keyPoints.map((p, i) => <li key={i}>{p}</li>)}</ul>
      </Section>
      {summary.decisions.length > 0 && (
        <Section title="Decisions">
          <ul className="list-disc space-y-1 pl-5">{summary.decisions.map((d, i) => <li key={i}>{d}</li>)}</ul>
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="font-semibold">{title}</h3>
      {children}
    </section>
  );
}
```

- [ ] **Step 3: Create `components/transcript-view.tsx`**

```tsx
'use client';

import { formatTimestamp } from '@/lib/transcript/format';

const SPEAKER_COLORS = ['text-blue-600', 'text-emerald-600', 'text-amber-600', 'text-fuchsia-600', 'text-cyan-600', 'text-rose-600'];

export function speakerColor(speaker: string): string {
  return SPEAKER_COLORS[speaker.charCodeAt(0) % SPEAKER_COLORS.length];
}

export type Line = { id: number; speaker: string; startMs: number; text: string };

export function TranscriptView({ lines, activeId, onSeek }: { lines: Line[]; activeId: number | null; onSeek: (ms: number) => void }) {
  if (lines.length === 0) return <p className="text-sm text-muted-foreground">No speech was detected.</p>;
  return (
    <ol className="space-y-3 text-sm">
      {lines.map((l) => (
        <li key={l.id} id={`u-${l.id}`} className={`rounded p-2 ${l.id === activeId ? 'bg-muted' : ''}`}>
          <button type="button" onClick={() => onSeek(l.startMs)} className="mr-2 font-mono text-xs text-muted-foreground hover:underline">
            {formatTimestamp(l.startMs)}
          </button>
          <span className={`font-medium ${speakerColor(l.speaker)}`}>Speaker {l.speaker}</span>
          <p className="mt-1 leading-relaxed">{l.text}</p>
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 4: Create `components/meeting-view.tsx`** (the chat pane is a placeholder until Task 8 replaces it)

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { SummaryView } from '@/components/summary-view';
import { type Line, TranscriptView } from '@/components/transcript-view';
import type { MeetingStatus } from '@/lib/db/schema';
import type { Summary } from '@/lib/summary-schema';
import { formatTimestamp } from '@/lib/transcript/format';

export type MeetingViewProps = {
  meeting: {
    id: string;
    title: string;
    status: MeetingStatus;
    error: string | null;
    audioUrl: string;
    durationSec: number | null;
    createdAt: string;
    summary: Summary | null;
  };
  lines: Line[];
  initialSeekMs: number | null;
};

const STATUS_TEXT: Record<MeetingStatus, string> = {
  transcribing: 'Transcribing… this usually takes a fraction of the recording length.',
  summarizing: 'Writing the summary…',
  ready: 'Ready',
  failed: 'Failed',
};

function useStatusPolling(id: string, status: MeetingStatus) {
  const router = useRouter();
  useEffect(() => {
    if (status !== 'transcribing' && status !== 'summarizing') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const res = await fetch(`/api/meetings/${id}`, { cache: 'no-store' });
        if (res.ok) {
          const data = (await res.json()) as { status: MeetingStatus };
          if (data.status !== status) {
            router.refresh();
            return;
          }
        }
      } catch {
        // network blip: keep polling
      }
      if (!cancelled) timer = setTimeout(poll, 3000);
    }
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id, status, router]);
}

export function MeetingView({ meeting, lines, initialSeekMs }: MeetingViewProps) {
  useStatusPolling(meeting.id, meeting.status);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [currentMs, setCurrentMs] = useState(0);

  const seek = useCallback((ms: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = ms / 1000;
    void audio.play().catch(() => {});
  }, []);

  const activeId = useMemo(() => lines.findLast((l) => l.startMs <= currentMs)?.id ?? null, [lines, currentMs]);

  function onLoadedMetadata() {
    if (initialSeekMs === null || !audioRef.current) return;
    audioRef.current.currentTime = initialSeekMs / 1000;
    setCurrentMs(initialSeekMs);
    const target = lines.findLast((l) => l.startMs <= initialSeekMs);
    if (target) document.getElementById(`u-${target.id}`)?.scrollIntoView({ block: 'center' });
  }

  const inProgress = meeting.status === 'transcribing' || meeting.status === 'summarizing';

  return (
    <main className="mx-auto max-w-7xl space-y-4 p-6">
      <header className="space-y-1">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{meeting.title}</h1>
          <Badge variant={meeting.status === 'failed' ? 'destructive' : 'secondary'}>{meeting.status}</Badge>
        </div>
        <p className="text-sm text-muted-foreground" suppressHydrationWarning>
          {new Date(meeting.createdAt).toLocaleString()}
          {meeting.durationSec !== null && ` · ${formatTimestamp(meeting.durationSec * 1000)}`}
        </p>
      </header>

      {inProgress && <p className="rounded-md border p-4 text-sm">{STATUS_TEXT[meeting.status]}</p>}
      {meeting.status === 'failed' && (
        <p className="rounded-md border border-destructive p-4 text-sm text-destructive">{meeting.error ?? 'Processing failed.'}</p>
      )}

      <audio
        ref={audioRef}
        src={meeting.audioUrl}
        controls
        preload="metadata"
        className="w-full"
        onLoadedMetadata={onLoadedMetadata}
        onTimeUpdate={(e) => setCurrentMs(e.currentTarget.currentTime * 1000)}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr_380px]">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Summary</h2>
          {meeting.summary ? <SummaryView summary={meeting.summary} /> : <p className="text-sm text-muted-foreground">Not available yet.</p>}
        </section>
        <section className="space-y-3 lg:max-h-[75vh] lg:overflow-y-auto">
          <h2 className="text-lg font-semibold">Transcript</h2>
          {lines.length > 0 || meeting.status === 'ready' ? (
            <TranscriptView lines={lines} activeId={activeId} onSeek={seek} />
          ) : (
            <p className="text-sm text-muted-foreground">Not available yet.</p>
          )}
        </section>
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Ask about this meeting</h2>
          <p className="text-sm text-muted-foreground">Chat arrives in Task 8.</p>
        </section>
      </div>
    </main>
  );
}
```

- [ ] **Step 5: Verify in the browser**

Run: `npm run dev`. Open the ready meeting from Task 6, then:
- The summary shows an overview, action items and key points; the transcript shows Speaker A and B in different colors.
- Clicking a timestamp plays audio from that point, and the playing line is highlighted as audio advances.
- `/meetings/<id>?t=60000` opens with the player at 1:00 and that line scrolled into view; `?t=abc` loads normally at 0:00.
- `/meetings/not-a-uuid` shows the 404 page.
- Upload a new file and stay on its page: the status text changes by itself to Writing the summary…, then to the full view, with no manual reload.

Run: `npx tsc --noEmit`. Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/meetings components/meeting-view.tsx components/summary-view.tsx components/transcript-view.tsx
git commit -m "feat: meeting page with summary, diarized transcript and seekable audio"
```

---

## Task 8: Chat about the meeting

**Files:**
- Create: `app/api/meetings/[id]/chat/route.ts`, `components/chat-panel.tsx`
- Modify: `components/meeting-view.tsx` (replace the chat placeholder)

**Interfaces:**
- Consumes: `llm`, `chatInstructions`, `formatTranscript`, `isUuid`, `db`
- Produces: `POST /api/meetings/:id/chat` (AI SDK UI message stream; 404 unknown, 409 not ready); `ChatPanel({ meetingId }: { meetingId: string })` (gains `onSeek` in Task 11)

- [ ] **Step 1: Create `app/api/meetings/[id]/chat/route.ts`**

```ts
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
```

- [ ] **Step 2: Create `components/chat-panel.tsx`**

```tsx
'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const SUGGESTIONS = ['What were the main decisions?', 'What are my action items?', 'Summarize the disagreements.'];

export function ChatPanel({ meetingId }: { meetingId: string }) {
  const [input, setInput] = useState('');
  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({ api: `/api/meetings/${meetingId}/chat` }),
  });
  const busy = status === 'submitted' || status === 'streaming';

  function send(text: string) {
    if (!text.trim() || busy) return;
    void sendMessage({ text });
    setInput('');
  }

  return (
    <div className="flex h-[60vh] flex-col rounded-md border">
      <div className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
        {messages.length === 0 && (
          <div className="space-y-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" onClick={() => send(s)} className="block w-full rounded border p-2 text-left hover:bg-muted">
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === 'user' ? 'ml-8 rounded bg-muted p-2' : 'mr-4 whitespace-pre-wrap'}>
            {m.parts.map((part, i) => (part.type === 'text' ? <span key={i}>{part.text}</span> : null))}
          </div>
        ))}
        {status === 'submitted' && <p className="text-muted-foreground">Thinking…</p>}
        {error && <p className="text-destructive">Something went wrong. Try again.</p>}
      </div>
      <form
        className="flex gap-2 border-t p-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about this meeting…" />
        <Button type="submit" disabled={busy || !input.trim()}>
          Ask
        </Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Modify `components/meeting-view.tsx`**: add `import { ChatPanel } from '@/components/chat-panel';` and replace the placeholder paragraph `<p className="text-sm text-muted-foreground">Chat arrives in Task 8.</p>` with:

```tsx
{meeting.status === 'ready' ? (
  <ChatPanel meetingId={meeting.id} />
) : (
  <p className="text-sm text-muted-foreground">Chat is available once processing finishes.</p>
)}
```

- [ ] **Step 4: Verify**

In the browser on the ready wildfires meeting, ask "What causes the air quality problems they discuss?". Expected: a streamed answer that is grounded in the transcript and contains `[mm:ss]` timestamps. Ask "What did they say about football?". Expected: it says the transcript doesn't cover that.

```bash
curl -s -X POST localhost:3000/api/meetings/$PENDING_ID/chat -H 'content-type: application/json' -d '{"messages":[]}' -o /dev/null -w '%{http_code}\n'
```

Expected: `409` for a meeting that is still processing (upload a fresh file to get `PENDING_ID`).

- [ ] **Step 5: Commit**

```bash
git add app/api/meetings/\[id\]/chat components/chat-panel.tsx components/meeting-view.tsx
git commit -m "feat: streaming Q&A chat grounded in the meeting transcript"
```

---

## Task 9: Meeting library and full-text search

**Files:**
- Create: `lib/search/highlight.ts`, `lib/search/search.ts`, `components/search-results.tsx`
- Replace: `app/page.tsx`
- Test: `tests/highlight.test.ts`

**Interfaces:**
- Consumes: `db`, `meetings`, `formatTimestamp`
- Produces:
  - `HIGHLIGHT_START = '⟦'`, `HIGHLIGHT_END = '⟧'`, `splitHighlights(snippet: string): { text: string; match: boolean }[]`
  - `type SearchHit = { meetingId: string; title: string; createdAt: string; startMs: number | null; snippet: string | null }`
  - `searchMeetings(query: string): Promise<SearchHit[]>`

- [ ] **Step 1: Write the failing test** `tests/highlight.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { splitHighlights } from '../lib/search/highlight';

describe('splitHighlights', () => {
  it('splits marked terms', () => {
    expect(splitHighlights('we ⟦ship⟧ the ⟦pricing⟧ page')).toEqual([
      { text: 'we ', match: false },
      { text: 'ship', match: true },
      { text: ' the ', match: false },
      { text: 'pricing', match: true },
      { text: ' page', match: false },
    ]);
  });
  it('returns plain text unchanged, including HTML-looking text', () => {
    expect(splitHighlights('<b>hi</b>')).toEqual([{ text: '<b>hi</b>', match: false }]);
  });
  it('handles an empty string', () => {
    expect(splitHighlights('')).toEqual([]);
  });
});
```

Run: `npm test -- tests/highlight.test.ts`. Expected: FAIL, the module is not found.

- [ ] **Step 2: Implement `lib/search/highlight.ts`** (unusual delimiters instead of `<mark>`, so transcript text is never rendered as HTML)

```ts
export const HIGHLIGHT_START = '⟦';
export const HIGHLIGHT_END = '⟧';

export function splitHighlights(snippet: string): { text: string; match: boolean }[] {
  const parts: { text: string; match: boolean }[] = [];
  const re = new RegExp(`${HIGHLIGHT_START}(.*?)${HIGHLIGHT_END}`, 'g');
  let last = 0;
  for (const m of snippet.matchAll(re)) {
    const index = m.index ?? 0;
    if (index > last) parts.push({ text: snippet.slice(last, index), match: false });
    parts.push({ text: m[1], match: true });
    last = index + m[0].length;
  }
  if (last < snippet.length) parts.push({ text: snippet.slice(last), match: false });
  return parts;
}
```

Run: `npm test -- tests/highlight.test.ts`. Expected: PASS.

- [ ] **Step 3: Implement `lib/search/search.ts`**

```ts
import { sql } from 'drizzle-orm';
import { db } from '../db';
import { HIGHLIGHT_END, HIGHLIGHT_START } from './highlight';

export type SearchHit = { meetingId: string; title: string; createdAt: string; startMs: number | null; snippet: string | null };

const HEADLINE_OPTIONS = `StartSel=${HIGHLIGHT_START},StopSel=${HIGHLIGHT_END},MaxWords=25,MinWords=10,MaxFragments=1`;

export async function searchMeetings(query: string): Promise<SearchHit[]> {
  const tsq = sql`websearch_to_tsquery('english', ${query})`;
  const titleHits = await db.execute(sql`
    select id as "meetingId", title, created_at::text as "createdAt", null::int as "startMs", null::text as snippet
    from meetings
    where to_tsvector('english', title) @@ ${tsq}
    order by created_at desc
    limit 20`);
  const lineHits = await db.execute(sql`
    select m.id as "meetingId", m.title, m.created_at::text as "createdAt", u.start_ms as "startMs",
           ts_headline('english', u.text, ${tsq}, ${HEADLINE_OPTIONS}) as snippet
    from utterances u
    join meetings m on m.id = u.meeting_id
    where u.tsv @@ ${tsq}
    order by ts_rank(u.tsv, ${tsq}) desc, m.created_at desc
    limit 50`);
  return [...titleHits.rows, ...lineHits.rows] as SearchHit[];
}
```

- [ ] **Step 4: Create `components/search-results.tsx`**

```tsx
import Link from 'next/link';
import { splitHighlights } from '@/lib/search/highlight';
import type { SearchHit } from '@/lib/search/search';
import { formatTimestamp } from '@/lib/transcript/format';

export function SearchResults({ query, hits }: { query: string; hits: SearchHit[] }) {
  if (hits.length === 0) return <p className="text-sm text-muted-foreground">No results for “{query}”.</p>;
  return (
    <ul className="divide-y rounded-md border">
      {hits.map((h, i) => (
        <li key={`${h.meetingId}-${h.startMs ?? 'title'}-${i}`}>
          <Link href={h.startMs === null ? `/meetings/${h.meetingId}` : `/meetings/${h.meetingId}?t=${h.startMs}`} className="block p-3 hover:bg-muted">
            <div className="flex justify-between text-sm font-medium">
              <span>{h.title}</span>
              {h.startMs !== null && <span className="font-mono text-xs text-muted-foreground">{formatTimestamp(h.startMs)}</span>}
            </div>
            {h.snippet && (
              <p className="mt-1 text-sm text-muted-foreground">
                {splitHighlights(h.snippet).map((p, j) =>
                  p.match ? <mark key={j} className="rounded bg-yellow-200 px-0.5 text-foreground">{p.text}</mark> : <span key={j}>{p.text}</span>,
                )}
              </p>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 5: Replace `app/page.tsx`**

```tsx
import { desc } from 'drizzle-orm';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SearchResults } from '@/components/search-results';
import { db } from '@/lib/db';
import { meetings } from '@/lib/db/schema';
import { searchMeetings } from '@/lib/search/search';
import { formatTimestamp } from '@/lib/transcript/format';

export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const { q } = await searchParams;
  const query = typeof q === 'string' ? q.trim() : '';

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Meetings</h1>
        <Button asChild>
          <Link href="/new">New meeting</Link>
        </Button>
      </div>
      <form action="/" className="flex gap-2">
        <Input name="q" defaultValue={query} placeholder="Search all transcripts…" />
        <Button type="submit" variant="secondary">Search</Button>
      </form>
      {query ? <SearchResults query={query} hits={await searchMeetings(query)} /> : <MeetingList />}
    </main>
  );
}

async function MeetingList() {
  const rows = await db
    .select({ id: meetings.id, title: meetings.title, status: meetings.status, durationSec: meetings.durationSec, createdAt: meetings.createdAt })
    .from(meetings)
    .orderBy(desc(meetings.createdAt))
    .limit(100);
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No meetings yet. <Link href="/new" className="underline">Upload your first recording.</Link>
      </p>
    );
  }
  return (
    <ul className="divide-y rounded-md border">
      {rows.map((m) => (
        <li key={m.id}>
          <Link href={`/meetings/${m.id}`} className="flex items-center justify-between gap-4 p-3 hover:bg-muted">
            <span className="font-medium">{m.title}</span>
            <span className="flex items-center gap-3 text-sm text-muted-foreground">
              {m.durationSec !== null && formatTimestamp(m.durationSec * 1000)}
              <span>{m.createdAt.toLocaleDateString()}</span>
              <Badge variant={m.status === 'failed' ? 'destructive' : 'secondary'}>{m.status}</Badge>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 6: Verify, including Review Focus 4**

With `npm run dev`:
- `/` lists meetings newest first, with duration, date and status.
- Search `smoke` (a word in the wildfires audio): the hits show highlighted snippets; clicking one opens the meeting at that timestamp.
- Each of these returns 200 and "No results" (or real results) rather than an error:

```bash
for q in 'the' '%22' 'C%2B%2B%20%26%26' '-' '%27%3B%20drop%20table%20meetings%3B--'; do curl -s "localhost:3000/?q=$q" -o /dev/null -w "$q %{http_code}\n"; done
```

Expected: every line ends with `200`.

Run: `npm test && npx tsc --noEmit`. Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add lib/search components/search-results.tsx app/page.tsx tests/highlight.test.ts
git commit -m "feat: meeting library with full-text transcript search and deep links"
```

---

## Task 10: README, production deploy, P0 gate

**Files:**
- Create: `README.md`, `.env.example`

- [ ] **Step 1: Create `.env.example`**

```
DATABASE_URL=
BLOB_READ_WRITE_TOKEN=
ASSEMBLYAI_API_KEY=
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-5
WEBHOOK_SECRET=
# Public https URL of the deployment; leave empty locally (status polling drives processing)
APP_URL=
```

- [ ] **Step 2: Write `README.md`** with exactly these sections:
  - **What it does:** one paragraph and the core loop.
  - **Live demo:** the production URL.
  - **Architecture:** the diagram from the spec's Architecture section, plus three sentences on `advanceMeeting` (webhook + poll, atomic claim, stale timeout).
  - **Local setup:** `npm install`, `vercel link`, `vercel env pull .env.local`, `npm run db:migrate`, `npm run dev`, `npm test`.
  - **Trade-offs:**
    - file upload is primary and browser recording is P1;
    - there's no bot joining calls;
    - chat uses the full transcript instead of RAG, because a 2h meeting is about 30k tokens;
    - search is Postgres FTS, not semantic;
    - there's no auth, and cost is capped by the 500MB/2h limits;
    - Blob URLs are public but unguessable;
    - chat isn't persisted;
    - the no-speech behaviour observed in Task 6 Step 7.
  - **What I'd do next:** the P1/P2 items not done.

- [ ] **Step 3: Deploy**

```bash
npm test && npx tsc --noEmit && npm run build
vercel deploy --prod
```

- [ ] **Step 4: P0 gate (from the spec, on the production URL). Every item must pass before any P1 work.**
  - [ ] Upload `test-audio/wildfires.mp3` and stay on the page. It reaches `ready` without a reload. Because `APP_URL` is set, the webhook should fire: in `vercel logs <production-url>`, check that a POST to `/api/webhooks/assemblyai` returned 200.
  - [ ] The transcript shows ≥2 speakers; the summary has an overview, key points and action items.
  - [ ] Clicking a transcript timestamp seeks the audio.
  - [ ] A chat answer is grounded in the transcript (it cites timestamps that match real lines).
  - [ ] A search for a word from the audio finds a hit whose link opens the meeting at that moment.
  - [ ] Failure path: create a text file named `broken.mp3` (`echo hello > test-audio/broken.mp3`) and upload it. The meeting shows the `failed` badge and AssemblyAI's error text on the page.
  - [ ] A 2h+ file or a >500MB file is rejected before upload with the matching message (test with any long file available; otherwise reason from the Task 3 tests and note it).

- [ ] **Step 5: Commit**

```bash
git add README.md .env.example
git commit -m "docs: README with architecture, setup and trade-offs"
```

**P0 is done here. Report the production URL and the gate results to the user before starting P1.**

---

## Task 11 (P1): Timestamp citations in chat → seek links

**Files:**
- Create: `lib/chat/citations.ts`
- Modify: `components/chat-panel.tsx`, `components/meeting-view.tsx`
- Test: `tests/citations.test.ts`

**Interfaces:**
- Produces: `timestampToMs(label: string): number | null`; `parseCitations(text: string): ({ type: 'text'; text: string } | { type: 'cite'; label: string; ms: number })[]`; `ChatPanel({ meetingId, onSeek })`

- [ ] **Step 1: Write the failing test** `tests/citations.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { parseCitations, timestampToMs } from '../lib/chat/citations';

describe('timestampToMs', () => {
  it('parses mm:ss and h:mm:ss', () => {
    expect(timestampToMs('01:05')).toBe(65_000);
    expect(timestampToMs('1:02:05')).toBe(3_725_000);
  });
  it('rejects invalid labels', () => {
    expect(timestampToMs('1:75')).toBeNull();
    expect(timestampToMs('abc')).toBeNull();
  });
});

describe('parseCitations', () => {
  it('splits text and citations', () => {
    expect(parseCitations('Ship Friday [12:04], confirmed [1:00:10].')).toEqual([
      { type: 'text', text: 'Ship Friday ' },
      { type: 'cite', label: '12:04', ms: 724_000 },
      { type: 'text', text: ', confirmed ' },
      { type: 'cite', label: '1:00:10', ms: 3_610_000 },
      { type: 'text', text: '.' },
    ]);
  });
  it('leaves non-timestamp brackets as text', () => {
    expect(parseCitations('see [note]')).toEqual([{ type: 'text', text: 'see [note]' }]);
  });
});
```

Run: `npm test -- tests/citations.test.ts`. Expected: FAIL.

- [ ] **Step 2: Implement `lib/chat/citations.ts`**

```ts
export type ChatSegment = { type: 'text'; text: string } | { type: 'cite'; label: string; ms: number };

export function timestampToMs(label: string): number | null {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(label);
  if (!m) return null;
  const [h, min, s] = [Number(m[1] ?? 0), Number(m[2]), Number(m[3])];
  if (s > 59 || (m[1] !== undefined && min > 59)) return null;
  return ((h * 60 + min) * 60 + s) * 1000;
}

export function parseCitations(text: string): ChatSegment[] {
  const out: ChatSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(/\[((?:\d+:)?\d{1,2}:\d{2})\]/g)) {
    const ms = timestampToMs(m[1]);
    if (ms === null) continue;
    const index = m.index ?? 0;
    if (index > last) out.push({ type: 'text', text: text.slice(last, index) });
    out.push({ type: 'cite', label: m[1], ms });
    last = index + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out;
}
```

Run: `npm test -- tests/citations.test.ts`. Expected: PASS.

- [ ] **Step 3: Modify `components/chat-panel.tsx`**: change the signature to `export function ChatPanel({ meetingId, onSeek }: { meetingId: string; onSeek: (ms: number) => void })`, add `import { parseCitations } from '@/lib/chat/citations';`, and replace the text-part rendering line with:

```tsx
{m.parts.map((part, i) =>
  part.type === 'text' ? (
    <span key={i}>
      {m.role === 'assistant'
        ? parseCitations(part.text).map((seg, j) =>
            seg.type === 'cite' ? (
              <button key={j} type="button" onClick={() => onSeek(seg.ms)} className="mx-0.5 rounded bg-muted px-1 font-mono text-xs hover:underline">
                {seg.label}
              </button>
            ) : (
              <span key={j}>{seg.text}</span>
            ),
          )
        : part.text}
    </span>
  ) : null,
)}
```

- [ ] **Step 4: Modify `components/meeting-view.tsx`**: `<ChatPanel meetingId={meeting.id} onSeek={seek} />`.

- [ ] **Step 5: Verify**: ask a question; the citations render as chips, and clicking one seeks the audio and highlights that transcript line. Run `npm test && npx tsc --noEmit`.

- [ ] **Step 6: Commit**

```bash
git add lib/chat tests/citations.test.ts components/chat-panel.tsx components/meeting-view.tsx
git commit -m "feat: clickable timestamp citations in meeting chat"
```

---

## Task 12 (P1): Status stepper and Retry

**Files:**
- Create: `app/api/meetings/[id]/retry/route.ts`, `components/status-stepper.tsx`
- Modify: `components/meeting-view.tsx`

**Interfaces:**
- Consumes: `summarizeMeeting` (Task 6), `submitTranscription` (Task 4)
- Produces: `POST /api/meetings/:id/retry` → `202 { status }` | 404 | 409 (not failed)

- [ ] **Step 1: Create `app/api/meetings/[id]/retry/route.ts`**

```ts
import { and, count, eq } from 'drizzle-orm';
import { after, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { meetings, utterances } from '@/lib/db/schema';
import { isUuid } from '@/lib/ids';
import { submitTranscription } from '@/lib/pipeline/assemblyai';
import { summarizeMeeting } from '@/lib/pipeline/advance';

export const maxDuration = 300;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const meeting = await db.query.meetings.findFirst({ where: eq(meetings.id, id), columns: { status: true, audioUrl: true } });
  if (!meeting) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (meeting.status !== 'failed') return NextResponse.json({ error: 'Only failed meetings can be retried' }, { status: 409 });

  const [{ n }] = await db.select({ n: count() }).from(utterances).where(eq(utterances.meetingId, id));
  const isFailed = and(eq(meetings.id, id), eq(meetings.status, 'failed'));

  if (n > 0) {
    const claimed = await db.update(meetings).set({ status: 'summarizing', error: null }).where(isFailed).returning({ id: meetings.id });
    if (claimed.length === 0) return NextResponse.json({ error: 'Already retrying' }, { status: 409 });
    after(() => summarizeMeeting(id));
    return NextResponse.json({ status: 'summarizing' }, { status: 202 });
  }

  let assemblyaiId: string;
  try {
    assemblyaiId = await submitTranscription(meeting.audioUrl);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
  const claimed = await db.update(meetings).set({ status: 'transcribing', error: null, assemblyaiId }).where(isFailed).returning({ id: meetings.id });
  if (claimed.length === 0) return NextResponse.json({ error: 'Already retrying' }, { status: 409 });
  return NextResponse.json({ status: 'transcribing' }, { status: 202 });
}
```

- [ ] **Step 2: Create `components/status-stepper.tsx`**

```tsx
import type { MeetingStatus } from '@/lib/db/schema';

const STEPS = ['Uploaded', 'Transcribing', 'Summarizing', 'Ready'] as const;
const INDEX: Record<Exclude<MeetingStatus, 'failed'>, number> = { transcribing: 1, summarizing: 2, ready: 3 };

export function StatusStepper({ status }: { status: Exclude<MeetingStatus, 'failed'> }) {
  const current = INDEX[status];
  return (
    <ol className="flex items-center gap-2 text-sm">
      {STEPS.map((label, i) => (
        <li key={label} className="flex items-center gap-2">
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs ${
              i < current ? 'bg-primary text-primary-foreground' : i === current ? 'animate-pulse border-primary' : 'text-muted-foreground'
            }`}
          >
            {i + 1}
          </span>
          <span className={i <= current ? '' : 'text-muted-foreground'}>{label}</span>
          {i < STEPS.length - 1 && <span className="mx-1 h-px w-8 bg-border" />}
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 3: Modify `components/meeting-view.tsx`**
  - Replace the `inProgress` paragraph with `{inProgress && <div className="space-y-2 rounded-md border p-4"><StatusStepper status={meeting.status as 'transcribing' | 'summarizing'} /><p className="text-sm text-muted-foreground">{STATUS_TEXT[meeting.status]}</p></div>}`.
  - Add the Retry button to the failed box:

```tsx
const router = useRouter(); // add inside MeetingView
const [retrying, setRetrying] = useState(false);
async function retry() {
  setRetrying(true);
  await fetch(`/api/meetings/${meeting.id}/retry`, { method: 'POST' });
  setRetrying(false);
  router.refresh();
}
// in the failed block, after the error text:
<Button size="sm" variant="outline" className="mt-2" onClick={retry} disabled={retrying}>
  {retrying ? 'Retrying…' : 'Retry'}
</Button>
```

  (Change the failed `<p>` to a `<div>` so the button can nest; import `Button` and `StatusStepper`.)
- [ ] **Step 4: Verify**: temporarily set `ANTHROPIC_MODEL=not-a-model` in `.env.local`, restart dev, upload a file. The meeting fails with "Summary failed: …" and the transcript stays visible. Restore the model, restart, click Retry. It reaches `ready` without re-transcribing (the AssemblyAI dashboard shows no new transcript). For the `broken.mp3` meeting, Retry resubmits and fails again with the AssemblyAI error.
- [ ] **Step 5: Commit**

```bash
git add app/api/meetings/\[id\]/retry components/status-stepper.tsx components/meeting-view.tsx
git commit -m "feat: processing stepper and retry for failed meetings"
```

---

## Task 13 (P1): Browser recording (mic + meeting tab)

**Files:**
- Create: `components/recorder.tsx`
- Modify: `app/new/page.tsx`

**Interfaces:**
- Consumes: `createMeeting`, `defaultTitle` (Task 5); `MAX_DURATION_SEC`, `MAX_UPLOAD_BYTES` (Task 3)

- [ ] **Step 1: Create `components/recorder.tsx`**

```tsx
'use client';

import { upload } from '@vercel/blob/client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { createMeeting, defaultTitle } from '@/lib/client/media';
import { MAX_DURATION_SEC, MAX_UPLOAD_BYTES } from '@/lib/limits';
import { formatTimestamp } from '@/lib/transcript/format';

type Session = {
  recorder: MediaRecorder;
  streams: MediaStream[];
  ctx: AudioContext;
  chunks: Blob[];
  startedAt: number;
  timer: number;
};

export function Recorder() {
  const router = useRouter();
  const [captureTab, setCaptureTab] = useState(true);
  const [title, setTitle] = useState('');
  const [phase, setPhase] = useState<'idle' | 'recording' | 'uploading'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState(0);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const session = useRef<Session | null>(null);

  useEffect(
    () => () => {
      const s = session.current;
      if (!s) return;
      clearInterval(s.timer);
      s.streams.forEach((st) => st.getTracks().forEach((t) => t.stop()));
      void s.ctx.close();
    },
    [],
  );

  async function start() {
    setError(null);
    setWarning(null);
    let mic: MediaStream;
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError('Microphone access was denied. Allow it in your browser’s site settings and try again.');
      return;
    }
    const streams = [mic];
    if (captureTab) {
      try {
        const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        if (display.getAudioTracks().length === 0) {
          display.getTracks().forEach((t) => t.stop());
          setWarning('The shared screen had no audio. Share a browser tab and turn on “Share tab audio” to capture other participants. Recording your mic only.');
        } else {
          streams.push(display);
        }
      } catch {
        setWarning('Tab sharing was cancelled. Recording your mic only.');
      }
    }

    const ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    for (const s of streams) ctx.createMediaStreamSource(new MediaStream(s.getAudioTracks())).connect(dest);
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    const recorder = new MediaRecorder(dest.stream, { mimeType });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.start(1000);
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const sec = Math.floor((Date.now() - startedAt) / 1000);
      setElapsed(sec);
      if (sec >= MAX_DURATION_SEC) void stop();
    }, 500);
    session.current = { recorder, streams, ctx, chunks, startedAt, timer };
    setElapsed(0);
    setPhase('recording');
  }

  async function stop() {
    const s = session.current;
    if (!s) return;
    session.current = null;
    clearInterval(s.timer);
    await new Promise<void>((resolve) => {
      s.recorder.onstop = () => resolve();
      s.recorder.stop();
    });
    s.streams.forEach((st) => st.getTracks().forEach((t) => t.stop()));
    await s.ctx.close();

    const blob = new Blob(s.chunks, { type: 'audio/webm' });
    const durationSec = Math.round((Date.now() - s.startedAt) / 1000);
    if (blob.size === 0) {
      setPhase('idle');
      return setError('Nothing was recorded.');
    }
    if (blob.size > MAX_UPLOAD_BYTES) {
      setPhase('idle');
      return setError('The recording is larger than 500MB.');
    }
    setPhase('uploading');
    try {
      const uploaded = await upload(`recordings/${Date.now()}.webm`, blob, {
        access: 'public',
        handleUploadUrl: '/api/blob/upload',
        contentType: 'audio/webm',
        multipart: blob.size > 50 * 1024 * 1024,
        onUploadProgress: (p) => setProgress(p.percentage),
      });
      const id = await createMeeting({ title: title.trim() || defaultTitle(), audioUrl: uploaded.url, durationSec });
      router.push(`/meetings/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setPhase('idle');
    }
  }

  return (
    <div className="space-y-4">
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Meeting title (optional)" disabled={phase !== 'idle'} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={captureTab} onChange={(e) => setCaptureTab(e.target.checked)} disabled={phase !== 'idle'} />
        Also capture a meeting tab (Google Meet, Zoom web…). Use headphones to avoid echo.
      </label>
      {phase === 'idle' && <Button onClick={start}>Start recording</Button>}
      {phase === 'recording' && (
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-2 font-mono">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-600" />
            {formatTimestamp(elapsed * 1000)}
          </span>
          <Button variant="destructive" onClick={stop}>Stop and transcribe</Button>
        </div>
      )}
      {phase === 'uploading' && <Progress value={progress} />}
      {warning && <p className="text-sm text-amber-600">{warning}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Modify `app/new/page.tsx`**

```tsx
import { Recorder } from '@/components/recorder';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Uploader } from '@/components/uploader';

export default function NewMeetingPage() {
  return (
    <main className="mx-auto max-w-xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">New meeting</h1>
      <Tabs defaultValue="upload">
        <TabsList>
          <TabsTrigger value="upload">Upload</TabsTrigger>
          <TabsTrigger value="record">Record</TabsTrigger>
        </TabsList>
        <TabsContent value="upload" className="pt-4"><Uploader /></TabsContent>
        <TabsContent value="record" className="pt-4"><Recorder /></TabsContent>
      </Tabs>
    </main>
  );
}
```

- [ ] **Step 3: Verify (Chrome, on the deployed URL; `getDisplayMedia` needs https or localhost)**
  - Open a YouTube interview in one tab. In the app, Record with tab capture on, share that tab with "Share tab audio" ticked, and speak a sentence yourself. After about 2 minutes, stop. The meeting reaches `ready`; the transcript contains both your sentence and the video's speakers.
  - Block the mic for the site. Start recording: the inline denial message shows.
  - Share a window instead of a tab: the amber "no audio" warning shows and a mic-only recording works.
- [ ] **Step 4: Commit**

```bash
git add components/recorder.tsx app/new/page.tsx
git commit -m "feat: in-browser recording of mic plus shared meeting tab"
```

---

## Task 14 (P1): Key moments

**Files:**
- Modify: `lib/summary-schema.ts`, `components/summary-view.tsx`, `components/meeting-view.tsx`

- [ ] **Step 1: Extend the schema** in `lib/summary-schema.ts`: add to `summarySchema`

```ts
keyMoments: z
  .array(z.object({ timestamp: z.string().describe('Timestamp of the moment exactly as in the transcript, e.g. 12:04'), label: z.string() }))
  .describe('3-8 moments worth jumping to: decisions, disagreements, commitments'),
```

  and add `keyMoments: []` to `EMPTY_SUMMARY`.
- [ ] **Step 2: Render it**: `SummaryView` takes `onSeek: (ms: number) => void`. Add `import { timestampToMs } from '@/lib/chat/citations';` and, after the overview:

```tsx
{(summary.keyMoments ?? []).length > 0 && (
  <Section title="Key moments">
    <ul className="space-y-1">
      {(summary.keyMoments ?? []).map((k, i) => {
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
  </Section>
)}
```

  (`?? []` keeps summaries stored before this change rendering.) In `meeting-view.tsx`, pass `onSeek={seek}` to `SummaryView`.
- [ ] **Step 3: Verify**: upload a new file. The key moments appear, and clicking one seeks. Old meetings still render. Run `npx tsc --noEmit`.
- [ ] **Step 4: Commit**

```bash
git add lib/summary-schema.ts components/summary-view.tsx components/meeting-view.tsx
git commit -m "feat: key moments with seek links in the summary"
```

---

## Task 15 (P1): Fathom-like polish

**Files:**
- Create: `lib/summary-markdown.ts`, `tests/summary-markdown.test.ts`, `app/meetings/[id]/loading.tsx`
- Modify: `components/summary-view.tsx`

- [ ] **Step 1: Write the failing test** `tests/summary-markdown.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { summaryToMarkdown } from '../lib/summary-markdown';

describe('summaryToMarkdown', () => {
  it('renders sections and skips empty ones', () => {
    const md = summaryToMarkdown('Weekly sync', {
      overview: 'We planned the launch.',
      keyPoints: ['Launch Friday'],
      decisions: [],
      actionItems: [{ task: 'Write post', owner: 'Ana', due: 'Thursday' }, { task: 'QA', owner: null, due: null }],
      keyMoments: [],
    });
    expect(md).toBe(
      '# Weekly sync\n\nWe planned the launch.\n\n## Action items\n- [ ] Write post (Ana, Thursday)\n- [ ] QA\n\n## Key points\n- Launch Friday\n',
    );
  });
});
```

Run: `npm test -- tests/summary-markdown.test.ts`. Expected: FAIL.

- [ ] **Step 2: Implement `lib/summary-markdown.ts`**

```ts
import type { Summary } from './summary-schema';

export function summaryToMarkdown(title: string, s: Summary): string {
  const out = [`# ${title}`, '', s.overview, ''];
  const section = (heading: string, items: string[]) => {
    if (items.length === 0) return;
    out.push(`## ${heading}`, ...items, '');
  };
  section(
    'Action items',
    s.actionItems.map((a) => {
      const meta = [a.owner, a.due].filter(Boolean).join(', ');
      return `- [ ] ${a.task}${meta ? ` (${meta})` : ''}`;
    }),
  );
  section('Key points', s.keyPoints.map((p) => `- ${p}`));
  section('Decisions', s.decisions.map((d) => `- ${d}`));
  return out.join('\n');
}
```

Run: `npm test -- tests/summary-markdown.test.ts`. Expected: PASS.

- [ ] **Step 3: Add a Copy button** to `SummaryView` (it now needs `title: string`; pass `meeting.title` from `MeetingView`):

```tsx
const [copied, setCopied] = useState(false);
// top of the returned JSX:
<Button size="sm" variant="outline" onClick={async () => { await navigator.clipboard.writeText(summaryToMarkdown(title, summary)); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
  {copied ? 'Copied' : 'Copy as Markdown'}
</Button>
```

(`SummaryView` becomes a client component: add `'use client'` and import `useState`, `Button` and `summaryToMarkdown`.)

- [ ] **Step 4: Create `app/meetings/[id]/loading.tsx`**

```tsx
export default function Loading() {
  return (
    <main className="mx-auto max-w-7xl space-y-4 p-6">
      <div className="h-8 w-1/3 animate-pulse rounded bg-muted" />
      <div className="h-10 w-full animate-pulse rounded bg-muted" />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr_380px]">
        {[0, 1, 2].map((i) => <div key={i} className="h-96 animate-pulse rounded bg-muted" />)}
      </div>
    </main>
  );
}
```

- [ ] **Step 5: Visual pass (check each; fix only what fails)**
  - At a 375px width, the meeting page stacks Summary → Transcript → Chat with no horizontal scroll.
  - The transcript pane scrolls independently on desktop, and the audio player stays visible (`sticky top-0 z-10 bg-background` on the `<audio>` wrapper if it doesn't).
  - Library rows truncate long titles (`truncate` on the title span).
  - Pasting the copied Markdown into a Markdown previewer renders correctly.
- [ ] **Step 6: Deploy and commit**

```bash
npm test && npx tsc --noEmit && vercel deploy --prod
git add lib/summary-markdown.ts tests/summary-markdown.test.ts components/summary-view.tsx components/meeting-view.tsx app/meetings/\[id\]/loading.tsx
git commit -m "feat: copy summary as Markdown, loading skeleton, layout polish"
```
