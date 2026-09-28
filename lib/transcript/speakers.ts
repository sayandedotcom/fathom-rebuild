export type TimelineSpan = { name: string; startMs: number; endMs: number | null };

export function speakerName(label: string, names: Record<string, string>): string {
  return names[label]?.trim() || `Speaker ${label}`;
}

// Name each diarization label after the meeting participant whose speaking time it overlaps most.
export function matchSpeakers(
  utterances: { speaker: string; startMs: number; endMs: number }[],
  timeline: TimelineSpan[],
): Record<string, string> {
  const byStart = [...timeline].sort((a, b) => a.startMs - b.startMs);
  const spans = byStart.map((t, i) => ({ name: t.name, start: t.startMs, end: t.endMs ?? byStart[i + 1]?.startMs ?? Infinity }));
  const order = [...new Set(timeline.map((t) => t.name))];

  const talk = new Map<string, number>();
  const overlap = new Map<string, Map<string, number>>();
  for (const u of utterances) {
    talk.set(u.speaker, (talk.get(u.speaker) ?? 0) + (u.endMs - u.startMs));
    const perName = overlap.get(u.speaker) ?? new Map(order.map((n) => [n, 0]));
    for (const s of spans) {
      const ms = Math.min(u.endMs, s.end) - Math.max(u.startMs, s.start);
      if (ms > 0) perName.set(s.name, (perName.get(s.name) ?? 0) + ms);
    }
    overlap.set(u.speaker, perName);
  }

  const names: Record<string, string> = {};
  for (const [label, perName] of overlap) {
    let best: { name: string; ms: number } | null = null;
    for (const [name, ms] of perName) if (!best || ms > best.ms) best = { name, ms };
    const total = talk.get(label) ?? 0;
    if (best && total > 0 && best.ms >= total / 2) names[label] = best.name;
  }
  return names;
}
