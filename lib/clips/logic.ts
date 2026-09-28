import { timestampToMs } from '../chat/citations';

export const MAX_CLIP_MS = 5 * 60 * 1000;
export const LIVE_BEFORE_MS = 30_000;
export const LIVE_AFTER_MS = 5_000;
// Snapping to whole utterances may widen an edge by at most this much, so one long monologue can't swallow minutes.
export const MAX_SNAP_MS = 15_000;
export const CLIP_CUT_TIMEOUT_MS = 3 * 60 * 1000;
// A ranged-but-still-pending clip waits behind the summary and any earlier cuts in the same after(), so it needs
// a longer grace period than one already `cutting` before it's considered stuck.
export const CLIP_PENDING_TIMEOUT_MS = 10 * 60 * 1000;
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

export type ExcerptLine<T> = T & { partial: boolean };

// The share page's excerpt: only utterances that start inside the clip, plus (if it began earlier) the single
// utterance straddling the clip's start, flagged so the page can render it as leading "…" context.
export function excerptLines<T extends { startMs: number; endMs: number }>(lines: T[], range: ClipRange): ExcerptLine<T>[] {
  const inside = lines.filter((l) => l.startMs >= range.startMs && l.startMs < range.endMs).map((l) => ({ ...l, partial: false }));
  const lead = lines.find((l) => l.startMs < range.startMs && l.endMs > range.startMs);
  return lead ? [{ ...lead, partial: true }, ...inside] : inside;
}
