# Fanthom — highlights and shareable clips

## Context
Fathom lets you highlight a moment during a call, see where it lands in the recording, and share a clip with someone who wasn't on the call. Fanthom has none of this. The spec builds on the speakers/templates/titles/delete spec, which must ship first. That spec provides speaker names, `startResummarize`, and `DELETE /api/meetings/:id`, which this spec extends.

Decisions:
- **One concept:** a highlight is a clip whose range comes from a click during the call. A manual clip's range comes from a transcript selection. Both live in one `clips` table.
- **Real isolation:** every clip is cut to its own audio file on the server. The share page never references the meeting's recording.
- **Live highlights** exist for bot meetings (the meeting page while `in_meeting`) and for browser recordings. Uploads get manual clips only.

## Schema
- `clip_status` enum: `pending`, `cutting`, `ready`, `failed`
- `clip_origin` enum: `live`, `manual`
- `clips` table:
  - `id uuid pk`
  - `meeting_id uuid → meetings.id ON DELETE CASCADE`
  - `origin clip_origin`
  - `mark_ms integer null`: the live click offset in the recording
  - `start_ms integer null`, `end_ms integer null`: null until the range is known
  - `title text NOT NULL DEFAULT ''`
  - `status clip_status DEFAULT 'pending'`
  - `error text null`
  - `audio_url text null`
  - `share_token text unique NOT NULL`: 22 URL-safe random characters, independent of the ID
  - `created_at`, `updated_at`
  - index on `(meeting_id, start_ms)`

## Marking moments
- **Bot meetings:**
  - While the meeting is `in_meeting`, the meeting page shows a **Highlight** button that calls `POST /api/meetings/:id/clips` with `{ origin: 'live' }`.
  - The server fetches the bot and computes `botHighlightOffset(now, recordingStartedAt(bot.status_changes))`, reusing `lib/bot/outcome.ts`. The offset uses server time, so the client's clock doesn't matter.
  - It returns `409` when no recording has started yet, or when the meeting isn't `in_meeting`.
  - It inserts a `pending` clip with `mark_ms` set and returns `201 {id}`. A "Highlighted at mm:ss" toast confirms.
- **Browser recorder (`components/recorder.tsx`):**
  - A Highlight button pushes `Date.now() - startedAt` onto a local list.
  - `POST /api/meetings` accepts `highlights?: number[]` (zod: at most 50 entries, each between 0 and the duration).
  - Those rows are inserted as `pending` live clips.
- **Manual (any `ready` meeting):**
  - Selecting transcript lines shows a "Clip" action. It calls `POST /api/meetings/:id/clips` with `{ origin: 'manual', startMs, endMs, title? }`.
  - `selectionRange` validates the request: start < end, range within the duration, length at most 5 minutes.
  - The title defaults to the first line's text, cut to 60 characters.
  - The clip is inserted with its range and cutting starts right away.

## Where live highlights land
- In `advanceMeeting`, after the utterances are inserted, each pending live clip gets `liveClipRange(markMs, utterances, durationMs)`:
  - the raw window is `[mark − 30s, mark + 5s]`
  - the start snaps to the start of the utterance that contains it
  - the end snaps to the end of the utterance that contains it
  - both are clamped to `[0, duration]`
  - with no utterances, the raw window clamped to the duration is used
- `summarizeMeeting` passes the highlighted timestamps to Claude. The summary schema gains `highlights: { timestamp: string; label: string }[]`, one short label per given timestamp. Old summaries render with `?? []`.
- Labels are matched back to clips by timestamp and written to `title` only while `title = ''`, so a user edit is never overwritten.
- Cutting starts for every clip that now has a range.
- Highlights show up in three places:
  - markers on a thin bar under the audio player; clicking one seeks
  - a colored band across the transcript lines in each clip's range
  - a **Highlights** section in `SummaryView` and in the Markdown export, with seek links.
- If the meeting ends `failed`, its live clips stay `pending` and are never shown.

## Cutting
- `cutClip(id)` runs in `after()`:
  1. Atomic claim: `UPDATE clips SET status='cutting' WHERE id=$1 AND status IN ('pending','failed') AND start_ms IS NOT NULL RETURNING`.
  2. `ffmpeg-static`: `-ss <start> -to <end> -i <meeting audio_url> -vn -c:a libmp3lame -b:a 96k -f mp3 pipe:1`. HTTP input seeking means only the needed ranges are fetched.
  3. `put('clips/<id>.mp3', …, { access: 'public', addRandomSuffix: true })`.
  4. Guarded `UPDATE … SET status='ready', audio_url=… WHERE id=$1 AND status='cutting'`. If the clip was deleted meanwhile, the new Blob is removed.
- **Errors:** ffmpeg or upload errors set `status='failed'` with a message. A clip stuck in `cutting` for more than 3 minutes is marked failed when it's next read (a `stale.ts` pattern). `POST /api/clips/:id/retry` runs the cut again.
- The ffmpeg binary must be traced into the route's function bundle. Before writing it, check the Next 16 docs in `node_modules/next/dist/docs` for the current file-tracing config. Verify it on a deployed function.

## Share page `/c/[token]`
- Server component, no client data fetching. It loads the clip by `share_token` joined with the meeting's title and speaker names, plus the utterances inside the range.
- **Ready:** it shows
  - the clip title and "from <meeting title>"
  - an `<audio>` with the clip's `audio_url`
  - the excerpt lines with speaker names, timed relative to the clip start
  - `generateMetadata` Open Graph title and description.
- **Pending, cutting or failed:** "This clip is still being prepared."
- **Unknown token:** `notFound()`.
- There's no link to the meeting, and the meeting's `audio_url` never appears on the page.

## Meeting page
- A **Clips** list (title, range, status) with these actions:
  - Copy link (`<origin>/c/<token>`)
  - Retry, for failed clips
  - Delete
- `DELETE /api/clips/:id` → `204`. It deletes the clip's Blob (errors logged and ignored), then the row.
- Deleting a meeting now also deletes its clips' Blobs before the row is deleted. The clip rows cascade.
- The page's existing status polling also refreshes clip status while any clip is `pending` or `cutting`.

## API summary
| Route | Body | Result |
|---|---|---|
| `POST /api/meetings/:id/clips` | `{origin:'live'}` \| `{origin:'manual', startMs, endMs, title?}` | `201 {id}`, `400`, `404`, `409` |
| `DELETE /api/clips/:id` | none | `204`, `404` |
| `POST /api/clips/:id/retry` | none | `202`, `404`, `409` (unless failed) |
| `POST /api/meetings` | adds `highlights?: number[]` | unchanged |

## Testing
- **vitest (pure):**
  - `liveClipRange`: snapping, clamping at 0 and at the duration, a mark inside a silence gap, no utterances
  - `selectionRange`: validity and the 5-minute cap
  - `botHighlightOffset`: before recording starts → null
  - label-to-clip matching by timestamp
  - the share token format
  - `summaryToMarkdown` with highlights
- **Live:**
  1. Press Highlight twice during a real bot call. After processing, both appear labeled in the summary, in the transcript and on the scrubber.
  2. Highlight during a browser recording. It lands the same way.
  3. Select transcript lines on an upload and clip them. The clip becomes ready.
  4. Open the link in incognito. Only the clip plays, and the page source has no meeting Blob URL.
  5. Delete the clip. The link returns 404 and the clip's Blob returns 404.
  6. Run the ffmpeg cut on the deployed site, not only locally.
