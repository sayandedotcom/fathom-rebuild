# Fanthom — minimal AI meeting assistant (Fathom-like)

## Context
Take-home assignment (8x). The repo `~/Desktop/fanthom` is greenfield: it holds only the agent-capture hooks (`.claude/`, `.agent-logs/`, `CAPTURE-TEST.md`), which must stay untouched. Goal: a deployed, working demo of the core Fathom loop: **capture meeting audio → diarized transcript → AI summary + action items → ask questions about the meeting → find past meetings**. Reviewers judge a reliable end-to-end loop over breadth.

Decisions made in brainstorming:
- Audio in: in-browser recording (mic + shared meeting tab, mixed) **or** file upload. No meeting bot.
- Features: speaker-labelled transcript, summary + action items, per-meeting chat, meeting library + full-text search.
- Stack: Next.js (App Router, TS) on Vercel · Neon Postgres + Drizzle · Vercel Blob · AssemblyAI (batch, `speaker_labels`) · Claude `claude-sonnet-5` via AI SDK (`@ai-sdk/anthropic`).
- Pipeline: async batch; chat puts the full transcript in context (no RAG or vectors); search uses Postgres FTS.
- No auth (user dropped the gate); cost is capped by upload limits (500MB, 2h).
- Chat history is not persisted.

## Architecture
```
Browser ──record/pick file──► Vercel Blob (client upload via /api/blob/upload)
   │ POST /api/meetings {title, blobUrl, durationSec}
   ▼
meetings(status=transcribing) ──► AssemblyAI transcript (speaker_labels, webhook_url?secret=…)
        webhook /api/webhooks/assemblyai ─┐
        GET /api/meetings/:id (poll 3s) ──┴─► advanceMeeting(id)
             1. if AssemblyAI not completed → return
             2. atomic claim: UPDATE meetings SET status='summarizing' WHERE id=$1 AND status='transcribing' RETURNING
             3. insert utterances (if not already present)
             4. summarize (generateObject, zod schema, 1 retry)
             5. status='ready' | 'failed' + error
```
`webhook_url` is sent only when `APP_URL` is a public https URL; on localhost the 3s status poll alone drives `advanceMeeting`.
Statuses: `transcribing → summarizing → ready`, with `failed` possible from either step. "Uploading" exists only in the client UI.
Retry (`POST /api/meetings/:id/retry`): if utterances exist, re-summarize; otherwise resubmit to AssemblyAI.

**Summary schema:** `{ overview: string, keyPoints: string[], decisions: string[], actionItems: { task, owner?, due? }[] }`
**Transcript prompt format:** `[mm:ss] Speaker A: text`, one utterance per line; used by both summary and chat.

## Data model (Drizzle, `lib/db/schema.ts`)
- `meetings`: id uuid pk, title, audioUrl, durationSec, status enum, error text null, assemblyaiId, summary jsonb null, createdAt.
- `utterances`: id, meetingId fk (cascade), speaker, startMs, endMs, text, `tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED`, GIN index on tsv, index on (meetingId, startMs).
- Search: `websearch_to_tsquery` over utterances joined to meetings (title matched too), `ts_headline` for snippets, and a deep link to `/meetings/:id?t=<startMs>`.

## File layout
- `app/page.tsx`: library + search (server component reading the DB; `?q=` param)
- `app/new/page.tsx`: Record / Upload tabs, title, upload progress, redirect
- `app/meetings/[id]/page.tsx`: status stepper; when ready, Summary | Transcript + audio player | Chat
- `app/api/blob/upload/route.ts`: `handleUpload`; `onBeforeGenerateToken` enforces audio/video types and 500MB
- `app/api/meetings/route.ts`: POST create + submit to AssemblyAI
- `app/api/meetings/[id]/route.ts`: GET status (calls `advanceMeeting` while transcribing)
- `app/api/meetings/[id]/retry/route.ts`, `app/api/meetings/[id]/chat/route.ts` (`streamText`, `maxDuration` set)
- `app/api/webhooks/assemblyai/route.ts`: verify secret query param → `advanceMeeting`
- `lib/pipeline/{advance,assemblyai,summarize}.ts`, `lib/transcript/format.ts`, `lib/db/{schema,index}.ts`
- `components/{recorder,uploader,status-stepper,summary-view,transcript-view,chat-panel}.tsx`: `recorder` mixes the `getUserMedia` mic and the `getDisplayMedia({audio:true})` tab through an AudioContext into one MediaRecorder (webm/opus), warns if the tab has no audio track, and enforces the 2h cap
- UI: Tailwind + shadcn/ui; AI SDK `useChat` for chat

Env: `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, `ASSEMBLYAI_API_KEY`, `ANTHROPIC_API_KEY`, `WEBHOOK_SECRET`, `APP_URL`.

## Error handling
- Mic/tab permission denied or no tab audio: inline message before recording starts.
- Wrong type or over the limit: rejected on the client and in `onBeforeGenerateToken`.
- AssemblyAI error, or summary failing after one retry: `failed` + error text + Retry button; the transcript stays visible when only the summary failed.
- Webhook secret mismatch: 401.

## Build order
1. Scaffold Next.js + Tailwind + shadcn, Drizzle + Neon, schema + migration.
2. Upload path (Blob client upload) → create meeting → AssemblyAI submit.
3. `advanceMeeting` + summarize + status polling + webhook; stepper UI.
4. Meeting page: summary, transcript with seekable audio, chat.
5. Recorder (mic + tab mixing).
6. Library + FTS search with deep links.
7. Tests, README (setup, env, architecture, trade-offs), deploy to Vercel.

## Verification
- `vitest`: AssemblyAI utterance → row mapping; `formatTranscript`; summary zod schema; `advanceMeeting` with mocked AssemblyAI and LLM clients: two concurrent calls → exactly one summarize call; failure → `failed`; retry → `ready`.
- `next build` and typecheck pass.
- Manual E2E on the deployed Vercel URL: (a) record ~2 min of a Meet tab with two voices, then check diarization (≥2 speakers), summary, action items, a chat answer citing timestamps, and search hit → deep link seeks audio; (b) upload a sample mp3 file and check the same flow; (c) deny mic permission, then check the inline error; (d) force a bad API key, then check the failed state and that Retry recovers.

## Next step
Step-by-step implementation plan via `superpowers:writing-plans`.
