# Fanthom — speaker names, meeting templates, auto titles, delete

## Context
Fanthom (Next.js 16 on Vercel, Neon + Drizzle, Vercel Blob, AssemblyAI, Claude via AI SDK 7, Recall.ai Meet bot) turns meetings into transcripts, summaries, chat and search. Four gaps show up first in a demo:
- Speakers are anonymous letters.
- Every meeting gets the same summary shape.
- Untitled meetings are named after their date.
- Nothing can be deleted.

This spec closes all four. The "Ask across all meetings" feature was considered and dropped.

Decisions:
- **Speaker names:** stored per meeting, used everywhere (transcript, Claude prompts, search results). Renaming re-summarizes. Bot meetings are named automatically from Recall's speaker timeline.
- **Templates:** General, Sales call, 1:1, Standup, Interview. Chosen at creation and changeable later; a change re-summarizes.
- **Auto titles:** Claude titles meetings the user left untitled. A user-typed or user-edited title is never overwritten.
- **Delete:** plain delete (no auth, no protection, confirm dialog). It removes the Blob audio, the meeting row and its utterances, and makes an active bot leave.

## Shared: re-summarize
- `POST /api/meetings/:id/resummarize`:
  - atomic claim `UPDATE meetings SET status='summarizing' WHERE id=$1 AND status='ready' RETURNING id`
  - then `after(() => summarizeMeeting(id))` → `202 {status:'summarizing'}`
  - `404` if the ID is unknown or not a UUID; `409` if the meeting isn't `ready`
- It reuses `summarizeMeeting`, the existing stale-summarizing timeout (6 min) and the page's status polling. Both the rename and template endpoints call the same internal `startResummarize(id)` helper, rather than the client calling two endpoints.

## Speaker names
- **Schema:** `meetings.speaker_names jsonb NOT NULL DEFAULT '{}'`, typed `Record<string, string>` (label → name).
- **Display:** `speakerName(label, names) = names[label]?.trim() || \`Speaker ${label}\``. It's used by the transcript view, by `formatTranscript` (so Claude's summary and chat see `[mm:ss] Priya: text`), and by search results.
- **Manual rename:**
  - Clicking a speaker label in the transcript opens an inline input. Enter saves and Escape cancels.
  - It calls `PATCH /api/meetings/:id/speakers` with body `{ label: string, name: string }`:
    - `label` must be a speaker present in that meeting's utterances
    - `name` is trimmed to 1–60 characters; an empty name clears it back to the letter
  - The route updates `speaker_names`, then starts a re-summarize if the meeting is `ready`.
  - It responds `200 {speakerNames, status}`, `400` for bad input, `404` for an unknown meeting.
- **Automatic (bot meetings):**
  - In `advanceMeeting`, after the utterances are inserted and before `summarizeMeeting`, meetings with `source='bot'` fetch Recall's speaker timeline:
    - `GET /bot/{id}` gives `recordings[0].media_shortcuts.participant_events.data.speaker_timeline_download_url`
    - that URL returns JSON entries `{ participant: { id, name }, start_timestamp: { relative }, end_timestamp: { relative } | null }`, in seconds relative to recording start
  - The pure function `matchSpeakers(utterances: {speaker,startMs,endMs}[], timeline: {name,startMs,endMs}[]): Record<string,string>` works as follows:
    - A null `end_timestamp` takes the next entry's start, or +∞ for the last entry.
    - Each AssemblyAI label gets the participant name with the greatest total overlap in ms.
    - The name is only assigned when that overlap is at least 50% of the label's total talk time.
    - Ties go to the participant listed first in the timeline.
    - Two labels may map to the same name; that's allowed, since diarization can split one person.
  - Any failure (network, missing URL, bad JSON) leaves `speaker_names` empty and processing continues. It never fails the meeting.
  - Verified live: our bot recordings already expose this timeline with real names (e.g. "Sayan De") under the default `recording_config`.

## Meeting templates
- **Schema:** `meeting_template` enum (`general`, `sales`, `one_on_one`, `standup`, `interview`) and `meetings.template` (default `general`).
- **The summary schema gains:**
  - `title: string` (at most 8 words, a descriptive meeting name)
  - `sections: { heading: string; items: string[] }[]` (template-specific; empty for `general`)
  - The existing overview, keyPoints, decisions, actionItems and keyMoments stay unchanged.
  - Old stored summaries lack both new fields and render with `?? []` / fallbacks.
- **Per-template instructions and headings,** appended to `SUMMARY_INSTRUCTIONS` via `templateInstructions(template)`:
  - `general`: none; `sections` is empty.
  - `sales`: "This is a sales call." Sections: Customer needs, Objections, Budget & timeline, Next steps.
  - `one_on_one`: "This is a 1:1 between a manager and a report." Sections: Wins, Concerns, Feedback, Follow-ups.
  - `standup`: "This is a team standup." Sections: Yesterday, Today, Blockers.
  - `interview`: "This is a job interview." Sections: Candidate background, Strengths, Concerns, Recommendation.
  - Instructions tell Claude to use exactly those headings, in that order, with each item one sentence. A section with nothing to say gets an empty list, not invented content.
- **Choosing a template:**
  - A `Template` select sits on all three `/new` tabs (Upload, Record, Join a meeting). Its value is sent as `template` in `POST /api/meetings` and `POST /api/meetings/bot`, and zod-validated against the enum with default `general`.
  - On the meeting page, a template select next to the title calls `PATCH /api/meetings/:id` with `{ template }`. That saves the template and starts a re-summarize when the meeting is `ready`.
- **Rendering:** `SummaryView` renders `sections` after Key points, skipping sections with empty items. The Markdown export includes them.

## Auto titles
- **Schema:** `meetings.title_is_auto boolean NOT NULL DEFAULT false`.
- **Creation:** the client no longer invents a date title. An empty title field sends `title: ''`. The server then stores `title = 'Untitled meeting'` and `title_is_auto = true`. This applies to all three creation routes; the zod `title` becomes `.trim().max(200)`, with empty allowed.
- **After summarizing:** `summarizeMeeting` sets `title = summary.title` only when `title_is_auto` is true and `summary.title` is not blank. This is guarded in SQL with `WHERE title_is_auto`, so a concurrent user edit wins.
- **Editing:** clicking the title on the meeting page makes it editable. Saving calls `PATCH /api/meetings/:id` with `{ title }` (1–200 characters) and sets `title_is_auto = false`.
- **No speech:** meetings with no speech keep "Untitled meeting", since `EMPTY_SUMMARY.title` is `''`.

## Delete
- `DELETE /api/meetings/:id` → `204`. It returns `404` if the ID is unknown or not a UUID. Steps:
  1. If the status is `in_meeting` and there's a `recall_bot_id`: `leaveCall` (errors are logged and ignored).
  2. If there's an `audio_url`: `del(audio_url)` from `@vercel/blob` (errors are logged and ignored, so a missing blob can't block the delete).
  3. `DELETE FROM meetings WHERE id=$1`; utterances cascade.
- **UI:** a "Delete" button on the meeting page opens `window.confirm("Delete this meeting? This removes the recording and transcript permanently.")`. On success it goes to `/` with `router.refresh()`. On failure it shows an inline error.
- **In-flight work:** background work already running for that meeting (summarizing, copying) finds no row and becomes a no-op. The existing guarded UPDATEs match nothing.

## PATCH /api/meetings/:id (shared)
- Body: zod, `{ title?: string (1–200, trimmed); template?: MeetingTemplate }`, with at least one field present.
- `title` sets `title_is_auto = false`.
- `template` triggers `startResummarize` when the meeting is `ready`.
- Returns `200 { title, template, status }`. Errors: `400` for bad input, `404` for an unknown meeting.

## Error handling
- A rename or template change while the meeting isn't `ready` (e.g. already summarizing) saves the value but doesn't start a second summary. The response carries the current `status`, and the next summary uses the saved value.
- A failed re-summary goes to `failed` with "Summary failed: …" as today. Retry re-summarizes because utterances exist.

## Testing
- vitest (pure):
  - `matchSpeakers`: clear majority, below 50% → none, null end timestamp, ties → first, one name on two labels, empty timeline.
  - `speakerName` / `formatTranscript` with names.
  - `templateInstructions` for each template, including its headings.
  - `pickAutoTitle(isAuto, summaryTitle)`.
  - `summaryToMarkdown` with sections.
- Live:
  1. Rename a speaker on a ready meeting. The status goes summarizing → ready, and the summary text uses the new name. Search results show the name.
  2. One bot run: the transcript shows the Meet display name without any manual step.
  3. Create with the Sales template: the summary shows the four Sales sections. Switch the template to Standup and the summary re-generates with Standup sections.
  4. Upload with no title: the library shows a descriptive title. Edit the title, then change the template: the edited title stays.
  5. Delete a meeting: `404` on its page, and the Blob URL returns 404.
  6. Delete a bot meeting while `in_meeting`: the bot leaves the call.
