import type { MeetingTemplate } from '@/lib/templates';

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

async function postForId(path: string, body: unknown): Promise<string> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!res.ok || !data.id) throw new Error(data.error ?? 'Could not create meeting');
  return data.id;
}

export function createMeeting(input: {
  title: string;
  audioUrl: string;
  durationSec: number | null;
  source: 'upload' | 'record';
  template: MeetingTemplate;
  highlights?: number[];
}): Promise<string> {
  return postForId('/api/meetings', input);
}

export function startBot(input: { title: string; meetingUrl: string; template: MeetingTemplate }): Promise<string> {
  return postForId('/api/meetings/bot', input);
}
