# Fanthom — Google Meet bot (Recall.ai)

## Context
Fanthom already turns uploaded or browser-recorded audio into a diarized transcript, a summary, chat and search. The pipeline is an idempotent `advanceMeeting` driven by the AssemblyAI webhook and a 3s status poll. This adds the headline Fathom feature: **a bot that joins a Google Meet call and records it**, so the meeting lands in the library without the user capturing audio themselves.

Decisions:
- **Hosted bot API: Recall.ai.** Chosen over a self-built Playwright bot, because Google blocks automated guest joins, the Meet UI breaks scrapers, and a long-running browser with audio can't run on Vercel functions.
- **Trigger: paste a Meet link and the bot joins now.** No scheduling and no calendar auto-join.
- **Transcription stays on AssemblyAI.** Recall supplies the audio only (`audio_mixed_mp3`), so bot meetings are processed exactly like uploads.
- **No auth,** as before. Cost stays bounded by Meet-only URLs, a 2h in-call cap and a 10 min waiting-room timeout.

## Recall.ai API used
- Base URL: `https://${RECALL_REGION}.recall.ai/api/v1`. Header: `Authorization: Token ${RECALL_API_KEY}`.
- `POST /bot` with:
  - `meeting_url`
  - `bot_name: "Fanthom Notetaker"`
  - `recording_config: { audio_mixed_mp3: {} }`
  - `automatic_leave: { waiting_room_timeout: 600 }`
  - `metadata: { meeting_id }`
  - Response: `{ id, ... }`.
- `GET /bot/{id}`: `status_changes[]` (the latest `code` + `sub_code`) and `recordings[]` (the first recording's `id`).
- `GET /audio_mixed?recording_id={id}`: `results[0].data.download_url` (an MP3). **This URL expires after 7 days**, so the audio is copied into Vercel Blob.
- `POST /bot/{id}/leave_call`: makes the bot leave (the Stop button and the 2h cap).
- Webhooks, configured in the Recall dashboard and delivered by Svix. The events used are `bot.joining_call`, `bot.in_waiting_room`, `bot.in_call_recording`, `bot.call_ended`, `bot.done` and `bot.fatal`, with a payload of `{ event, data: { data: { code, sub_code, updated_at }, bot: { id, metadata } } }`. The webhook is treated only as a trigger: the handler looks up the meeting by `bot.id` and runs `advanceMeeting`, which re-reads the truth from `GET /bot/{id}`. It is authenticated with the same `?secret=WEBHOOK_SECRET` query parameter as the AssemblyAI webhook.

Implementation must verify these field names against the live API (one real bot run) before building on them. The same applies to whether the `recording_config` / `automatic_leave` shapes are accepted.

## Architecture
```
/new → "Join a meeting" tab: Meet URL + title
  POST /api/meetings/bot {title, meetingUrl}
    → validate meet.google.com URL → Recall POST /bot → insert meetings(status='in_meeting', source='bot', recallBotId, botStatus='Joining')
Recall webhook /api/webhooks/recall?secret=… ─┐
GET /api/meetings/:id poll (3s, via after()) ─┴─► advanceMeeting(id)
   status in_meeting:
     bot = GET /bot/{recallBotId}; latest = last status_change
     update botStatus from latest.code (display text)
     if in call > 2h (first in_call_recording timestamp) → POST leave_call (once)
     if latest.code in {fatal, recording_permission_denied} or (call_ended/done with no recording) → failed + readable reason
     if latest.code == 'done' and a recording exists:
        atomic claim: UPDATE … SET status='transcribing' WHERE id=$1 AND status='in_meeting' RETURNING
        mp3 = GET /audio_mixed?recording_id → download_url
        stream mp3 → Vercel Blob put('meetings/bot-<id>.mp3') → audioUrl
        assemblyaiId = submitTranscription(audioUrl); save both
        (if copy or submit throws → failed with message; Retry re-runs the copy if audioUrl is null, else resubmits as today)
   status transcribing/summarizing/…: unchanged existing logic
```
- The claim → copy → submit sequence runs inside the same `after()` budget (`maxDuration` 300). An hour-long MP3 is about 60MB, which fits well inside that.
- A meeting in `transcribing` with a null `assemblyaiId` for more than 6 minutes means the copy died. It is marked failed, reusing the stale-detection pattern, and Retry recovers it.
- **Stop recording:** `POST /api/meetings/:id/stop-bot` calls `leave_call`. The normal `done` path then processes whatever was captured.

## Data model changes (Drizzle migration)
- `meeting_status` enum: add `in_meeting` (first in the flow).
- `meetings`:
  - add `source` enum `upload | record | bot` (default `upload`).
  - add `recallBotId` text unique, nullable.
  - add `botStatus` text, nullable.
  - add `botJoinedAt` timestamptz, nullable (set on the first `in_call_recording`; used for the 2h cap).
  - make `assemblyaiId` nullable (still unique).
  - make `audioUrl` nullable (null until the bot's audio is copied).
- The existing upload and record paths set `source`: the uploader sends `upload` and the recorder sends `record`.

## UI
- `/new`:
  - Tabs: **Upload | Record | Join a meeting**.
  - The join tab has a title field and a Meet URL field, validated on the client and the server against `^https://meet\.google\.com/[a-z]{3}-[a-z]{4}-[a-z]{3}$` (query string allowed).
  - Submitting redirects to the meeting page.
- The meeting page while `in_meeting`:
  - The stepper gets a first step, "In meeting", with the live `botStatus` text: "Joining…", "Waiting to be let in: admit Fanthom Notetaker in Meet", "Recording", "Processing recording".
  - A "Stop recording" button.
  - No audio player until `audioUrl` exists.
- Library: a "bot" badge for `source='bot'`.

## Error handling
Messages mapped from Recall codes (a pure function):
- Never admitted (waiting-room timeout) → "The bot wasn't let into the meeting."
- Removed or denied → "The bot was removed or not allowed to record."
- Meeting ended before the bot joined → "The meeting ended before the bot could record."
- `fatal` → "The bot hit an error: <sub_code>."
- Recall API errors on create → 502 on the join form; no row is created. This matches the upload path.
- Webhook with a wrong secret → 401. A webhook for an unknown bot → 200 no-op.

## Env
New variables: `RECALL_API_KEY`, `RECALL_REGION` (e.g. `us-west-2`), and optionally `RECALL_WAITING_ROOM_TIMEOUT_SEC` (default 600; sent as `automatic_leave.waiting_room_timeout`). The user enters them via the Vercel dashboard, as before. The Recall dashboard webhook points at `https://fanthom-xi.vercel.app/api/webhooks/recall?secret=<WEBHOOK_SECRET>`, in production only. Locally, the poll drives everything.

## Testing
- vitest (pure):
  - `isMeetUrl`
  - `recallStatusMessage(code, subCode)`
  - `latestBotStatus(status_changes)`
  - `botOverCap(joinedAt, now)`
- Manual end-to-end (needs the user to admit the bot):
  1. Paste a live Meet link.
  2. Check the status reaches "Waiting to be let in".
  3. Admit the bot, then talk for about a minute.
  4. Press Stop recording.
  5. Check it reaches `ready` with a transcript, summary, a playable audio file from the Blob URL, chat and search.
- Failure check: paste a Meet link and don't admit the bot. After the waiting-room timeout, the meeting shows the "wasn't let in" message. For the test, set `RECALL_WAITING_ROOM_TIMEOUT_SEC=60` locally.

## Out of scope
Scheduled joins, calendar auto-join, Zoom/Teams (Recall supports them, but the URL validator stays Meet-only), and real participant names from Meet (Recall's speaker metadata).
