# Fanthom

A minimal, Fathom-style AI meeting assistant.

## What it does

Upload a meeting recording (audio or video, up to 500MB and 2 hours). Fanthom transcribes it with speaker labels, writes a summary with key points, decisions and action items, and lets you ask questions about the meeting in a chat that cites timestamps. Every meeting is kept in a searchable library. A search hit links to the exact moment in the recording.

Core loop: **upload → diarized transcript → AI summary + action items → ask questions → find past meetings**.

## Live demo

https://fanthom-xi.vercel.app

## Architecture

```
Browser ──pick file──► Vercel Blob (client upload via /api/blob/upload)
   │ POST /api/meetings {title, audioUrl, durationSec}
   ▼
meetings(status=transcribing) ──► AssemblyAI transcript (speaker_labels, webhook_url?secret=…)
        webhook /api/webhooks/assemblyai ─┐
        GET /api/meetings/:id (poll 3s) ──┴─► advanceMeeting(id)
             1. if AssemblyAI not completed → return (if AssemblyAI errored → failed)
             2. atomic claim: UPDATE meetings SET status='summarizing' WHERE id=$1 AND status='transcribing' RETURNING
             3. insert utterances
             4. summarize (Claude, structured output validated by a zod schema, 1 retry)
             5. status='ready' | 'failed' + error
```

`advanceMeeting` has two triggers, the AssemblyAI webhook and the meeting page's 3-second status poll. Both run it in `after()` so the HTTP response returns right away. Locally there is no public URL and no webhook, so the poll alone drives processing. If the webhook and the poll arrive together, the atomic `UPDATE … WHERE status='transcribing' RETURNING` lets only one of them go on to insert utterances and summarize. If a serverless function dies mid-summary, the meeting would sit in `summarizing` forever, so a meeting in that state for more than 6 minutes is marked `failed` ("Summarization timed out."). That timeout is longer than the routes' 300s `maxDuration`.

Stack:
- Next.js 16 (App Router) on Vercel, Tailwind 4 + shadcn/ui
- Neon Postgres + Drizzle ORM
- Vercel Blob
- AssemblyAI (batch transcription with `speaker_labels`)
- Claude through the AI SDK (`@ai-sdk/anthropic`). The model comes from `ANTHROPIC_MODEL` and defaults to `claude-sonnet-5`.

Code map:
- `lib/pipeline/`: AssemblyAI client, prompts, summarizer, `advanceMeeting`
- `lib/transcript/format.ts`: the `[mm:ss] Speaker A: text` transcript format shared by the summary and chat
- `lib/search/`: Postgres full-text search with `websearch_to_tsquery` and `ts_headline`
- `app/`: pages and API routes
- `components/`: UI

## Local setup

```bash
npm install
vercel link                 # link to your Vercel project (Neon + Blob connected to it)
vercel env pull .env.local  # DATABASE_URL, BLOB_READ_WRITE_TOKEN, ASSEMBLYAI_API_KEY, ANTHROPIC_API_KEY, ANTHROPIC_MODEL, WEBHOOK_SECRET
npm run db:migrate
npm run dev                 # http://localhost:3000
npm test                    # vitest: pure transcript, search and validation helpers
```

`.env.example` lists every variable. Leave `APP_URL` empty locally. In production it must be the public https URL so AssemblyAI can call the webhook. `npm run check:model` makes one real call to confirm the configured Claude model ID works.

## Trade-offs

- **File upload is the primary input.** Browser recording (mic + shared meeting tab) is the next step. Upload is the path that is guaranteed to work in any browser.
- **No bot joins calls.** Joining Zoom or Meet as a bot is a large project of its own and outside the scope of a 24h build.
- **Chat puts the full transcript in the prompt instead of using RAG.** A 2-hour meeting is roughly 30k tokens, well within Claude's context window. No retrieval step also means no missed context and no vector infrastructure.
- **Search is Postgres full-text search, not semantic search.** English stemming means "pricing" matches "price", but word families with different stems don't match each other ("decision" does not find "decided"). Each hit deep-links to the moment in the recording.
- **There's no auth.** Cost is capped by the upload limits: 500MB and 2 hours, checked in the browser and when the upload token is issued. The API accepts only Vercel Blob URLs, so it can't be used to make AssemblyAI fetch arbitrary URLs.
- **Blob URLs are public but unguessable** (random suffix). Anyone with a link can play the audio.
- **Chat history isn't saved.** It resets when the page reloads.
- **Recordings with no speech:** AssemblyAI completes a silent recording with no utterances. The meeting becomes `ready` with "No speech was detected in this recording." and no LLM call is made. This was tested with a 10-second silent WAV.
- **Transcription failures:** a file that isn't really audio (for example, a text file renamed `.mp3`) ends as `failed`, and AssemblyAI's error message is shown on the meeting page.

## What I'd do next

- Clickable `[mm:ss]` citations in chat that seek the audio
- A step-by-step processing indicator and a Retry button for failed meetings
- Browser recording: the mic mixed with a shared meeting tab
- Key moments: a clickable list of highlights
- Visual polish: loading skeletons and a copy-summary-as-Markdown button
- A fuller test suite, including `advanceMeeting` concurrency with mocked clients
- Richer search (speaker and date filters); integrations such as Slack, a CRM, or calendar
