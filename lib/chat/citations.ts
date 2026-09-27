export type ChatSegment = { type: 'text'; text: string } | { type: 'cite'; label: string; ms: number };

export function timestampToMs(label: string): number | null {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(label);
  if (!m) return null;
  const [h, min, s] = [Number(m[1] ?? 0), Number(m[2]), Number(m[3])];
  if (s > 59 || (m[1] !== undefined && min > 59)) return null;
  return ((h * 60 + min) * 60 + s) * 1000;
}

export function parseCitations(text: string): ChatSegment[] {
  const out: ChatSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(/\[((?:\d+:)?\d{1,2}:\d{2})\]/g)) {
    const ms = timestampToMs(m[1]);
    if (ms === null) continue;
    const index = m.index ?? 0;
    if (index > last) out.push({ type: 'text', text: text.slice(last, index) });
    out.push({ type: 'cite', label: m[1], ms });
    last = index + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out;
}
