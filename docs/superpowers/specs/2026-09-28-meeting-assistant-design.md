# Fanthom — minimal AI meeting assistant (Fathom-like)

## Context
Take-home assignment (8x), **24h window**. The brief allows stubbing audio capture. The repo `~/Desktop/fanthom` is greenfield: it holds only the agent-capture hooks (`.claude/`, `.agent-logs/`, `CAPTURE-TEST.md`), which must stay untouched. Goal: a deployed, working demo of the core Fathom loop: **upload meeting audio → diarized transcript → AI summary + action items → ask questions about the meeting → find past meetings**. Reviewers judge a reliable, polished end-to-end loop over breadth. The full P0 happy path ships before any P1 work starts.

Decisions:
- Audio in: **file upload is the guaranteed path (P0)**. In-browser recording (mic + shared meeting tab, mixed) is a P1 enhancement. No meeting bot.
- Features: speaker-labelled transcript, summary + action items, per-meeting chat, meeting library + full-text search.
- Stack: Next.js (App Router, TS) on Vercel · Neon Postgres + Drizzle · Vercel Blob · AssemblyAI (batch, `speaker_labels`) · Claude via AI SDK (`@ai-sdk/anthropic`). The model ID comes from `ANTHROPIC_MODEL` (default `claude-sonnet-5`) and is verified with a one-off call during scaffolding.
- Pipeline: async batch; chat puts the full transcript in context (no RAG or vectors, which would be infrastructure for its own sake at this size); search uses Postgres FTS.
- No auth; cost is capped by upload limits (500MB, 2h).
- Chat history is not persisted.

## Priorities
**P0: must work, deployed**
1. Scaffold Next.js + Tailwind + shadcn, Drizzle + Neon, schema + migration; verify the model ID; **deploy to Vercel immediately** so problems surface early.
2. Upload (Blob client upload) → create meeting → AssemblyAI submit.
3. `advanceMeeting` (atomic claim, utterances, summary) driven by the status poll and the webhook; a simple status indicator.
4. Meeting page: summary, action items, speaker-labelled transcript with timestamps, audio player (click timestamp → seek).
5. Chat about the meeting (`streamText`, full transcript in context).
6. Library + FTS search with snippets and deep links (`?t=`).
7. Failed state shows the error text. README (setup, env, architecture, trade-offs).

**P1: differentiators, in this order**
1. Timestamp citations in chat: the prompt asks for `[mm:ss]`, and the UI renders them as seek links.
2. Loading and error polish: status stepper, Retry button (`POST /api/meetings/:id/retry`), skeletons.
3. Browser recording (`components/recorder.tsx`).
4. Key moments: add `keyMoments: { startMs, label }[]` to the summary schema, shown as a clickable list.
5. Fathom-like UX polish.

**P2: only if time remains**
Vitest suite, richer search (filters, speaker search), extra integrations.

## Architecture
```
Browser ──pick file (P0) / record (P1)──► Vercel Blob (client upload via /api/blob/upload)
   │ POST /api/meetings {title, blobUrl, durationSec}
   ▼
meetings(status=transcribing) ──► AssemblyAI transcript (speaker_labels, webhook_url?secret=…)
        webhook /api/webhooks/assemblyai ─┐
        GET /api/meetings/:id (poll 3s) ──┴─► advanceMeeting(id)
             1. if AssemblyAI not completed → return (if AssemblyAI errored → failed)
             2. atomic claim: UPDATE meetings SET status='summarizing' WHERE id=$1 AND status='transcribing' RETURNING
             3. insert utterances
             4. summarize (generateObject, zod schema, 1 retry)
             5. status='ready' | 'failed' + error
```
- The atomic claim is P0 because the webhook and the poll can fire together; without it a meeting gets summarized twice.
- `webhook_url` is sent only when `APP_URL` is a public https URL; on localhost the 3s status poll alone drives `advanceMeeting`.
- Statuses: `transcribing → summarizing → ready`, with `failed` possible from either step. "Uploading" exists only in the client UI.
- Retry (P1): if utterances exist, re-summarize; otherwise resubmit to AssemblyAI.

**Summary schema (P0):** `{ overview: string, keyPoints: string[], decisions: string[], actionItems: { task, owner?, due? }[] }`
**Transcript prompt format:** `[mm:ss] Speaker A: text`, one utterance per line; used by both summary and chat.

## Data model (Drizzle, `lib/db/schema.ts`)
- `meetings`: id uuid pk, title, audioUrl, durationSec, status enum, error text null, assemblyaiId, summary jsonb null, createdAt.
- `utterances`: id, meetingId fk (cascade), speaker, startMs, endMs, text, `tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED`, GIN index on tsv, index on (meetingId, startMs).
- Search: `websearch_to_tsquery` over utterances joined to meetings (title matched too), `ts_headline` for snippets, and a deep link to `/meetings/:id?t=<startMs>`.

## File layout
- `app/page.tsx`: library + search (server component reading the DB; `?q=` param)
- `app/new/page.tsx`: upload (P0) with title and progress, then redirect; a Record tab is added in P1
- `app/meetings/[id]/page.tsx`: status; when ready, Summary | Transcript + audio player | Chat
- `app/api/blob/upload/route.ts`: `handleUpload`; `onBeforeGenerateToken` enforces audio/video types and 500MB
- `app/api/meetings/route.ts`: POST create + submit to AssemblyAI
- `app/api/meetings/[id]/route.ts`: GET status (calls `advanceMeeting` while transcribing)
- `app/api/meetings/[id]/chat/route.ts` (`streamText`, `maxDuration` set); `app/api/meetings/[id]/retry/route.ts` (P1)
- `app/api/webhooks/assemblyai/route.ts`: verify secret query param → `advanceMeeting`
- `lib/pipeline/{advance,assemblyai,summarize}.ts`, `lib/transcript/format.ts`, `lib/db/{schema,index}.ts`
- `components/{uploader,summary-view,transcript-view,chat-panel}.tsx` (P0); `components/{recorder,status-stepper}.tsx` (P1). `recorder` mixes the `getUserMedia` mic and the `getDisplayMedia({audio:true})` tab through an AudioContext into one MediaRecorder (webm/opus), warns if the tab has no audio track, and enforces the 2h cap.
- UI: Tailwind + shadcn/ui; AI SDK `useChat` for chat

Env: `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, `ASSEMBLYAI_API_KEY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `WEBHOOK_SECRET`, `APP_URL`.

## Error handling
- P0: wrong type or over the limit is rejected on the client and in `onBeforeGenerateToken`; an AssemblyAI error or a summary failing after one retry sets `failed` + error text shown on the page; the transcript stays visible when only the summary failed; a webhook secret mismatch returns 401.
- P1: Retry button; mic/tab permission denied or no tab audio → inline message before recording starts.

## Verification
- **P0 gate (before starting P1):** `next build` + typecheck pass; on the deployed Vercel URL, upload a sample two-speaker mp3 and check: ≥2 speakers in the transcript, summary + action items, a timestamp click seeks the audio, a chat answer grounded in the transcript, a search hit whose deep link seeks to the moment; force a bad AssemblyAI key and check the failed state shows the error.
- **P1:** record ~2 min of a Meet tab with two voices and run the same checks; deny mic permission and check the inline error; a chat citation click seeks the audio; Retry recovers a failed meeting.
- **P2:** vitest for utterance mapping, `formatTranscript`, summary schema, and `advanceMeeting` idempotency (two concurrent calls → one summarize call).

## Next step
Step-by-step implementation plan via `superpowers:writing-plans`.
