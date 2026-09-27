export type TranscriptLine = { speaker: string; startMs: number; text: string };

const pad = (n: number) => String(n).padStart(2, '0');

export function formatTimestamp(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function formatTranscript(lines: TranscriptLine[]): string {
  return lines.map((l) => `[${formatTimestamp(l.startMs)}] Speaker ${l.speaker}: ${l.text}`).join('\n');
}

export function parseSeekParam(t: string | string[] | undefined): number | null {
  if (typeof t !== 'string' || !/^\d+$/.test(t)) return null;
  return Number(t);
}
