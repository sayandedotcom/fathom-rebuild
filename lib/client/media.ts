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
