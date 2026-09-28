import { requireEnv } from '../env';
import type { TimelineSpan } from '../transcript/speakers';
import { BOT_RECORDING_CAP_SEC, type RecallStatusChange } from './outcome';

export type RecallBot = { id: string; status_changes: RecallStatusChange[]; recordings: { id: string }[] };

const DEFAULT_WAITING_ROOM_TIMEOUT_SEC = 600;

export class RecallError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// Outages, rate limits and network failures are worth retrying; 4xx answers are not.
export function isTransientRecallError(err: unknown): boolean {
  if (err instanceof RecallError) return err.status >= 500 || err.status === 429;
  return err instanceof TypeError;
}

export function waitingRoomTimeoutSec(): number {
  const value = Number(process.env.RECALL_WAITING_ROOM_TIMEOUT_SEC);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_WAITING_ROOM_TIMEOUT_SEC;
}

async function recall<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`https://${requireEnv('RECALL_REGION')}.recall.ai/api/v1${path}`, {
    ...init,
    headers: {
      authorization: `Token ${requireEnv('RECALL_API_KEY')}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new RecallError(`Recall ${init.method ?? 'GET'} ${path} failed (${res.status}): ${detail}`, res.status);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

export function botCreateBody(meetingUrl: string, meetingId: string) {
  return {
    meeting_url: meetingUrl,
    bot_name: 'Fanthom Notetaker',
    recording_config: { audio_mixed_mp3: {} },
    // Recall enforces the recording cap itself, so it holds even when nobody has the meeting page open.
    automatic_leave: { waiting_room_timeout: waitingRoomTimeoutSec(), in_call_recording_timeout: BOT_RECORDING_CAP_SEC },
    metadata: { meeting_id: meetingId },
  };
}

export async function createBot(meetingUrl: string, meetingId: string): Promise<string> {
  const bot = await recall<{ id: string }>('/bot/', { method: 'POST', body: JSON.stringify(botCreateBody(meetingUrl, meetingId)) });
  return bot.id;
}

export async function getBot(id: string): Promise<RecallBot> {
  const bot = await recall<Partial<RecallBot> & { id: string }>(`/bot/${encodeURIComponent(id)}/`);
  return { id: bot.id, status_changes: bot.status_changes ?? [], recordings: bot.recordings ?? [] };
}

export async function getMixedAudioUrl(recordingId: string): Promise<string | null> {
  const page = await recall<{ results?: { data?: { download_url?: string | null } | null }[] }>(
    `/audio_mixed/?recording_id=${encodeURIComponent(recordingId)}`,
  );
  return page.results?.[0]?.data?.download_url ?? null;
}

export async function leaveCall(id: string): Promise<void> {
  await recall(`/bot/${encodeURIComponent(id)}/leave_call/`, { method: 'POST' });
}

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
