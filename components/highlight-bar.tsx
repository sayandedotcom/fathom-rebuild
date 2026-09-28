'use client';

import type { ClipRange } from '@/lib/clips/logic';
import { formatTimestamp } from '@/lib/transcript/format';

type Marker = ClipRange & { id: string; title: string };

export function HighlightBar({ clips, durationMs, onSeek }: { clips: Marker[]; durationMs: number | null; onSeek: (ms: number) => void }) {
  if (!durationMs || clips.length === 0) return null;
  const pct = (ms: number) => Math.min(100, (ms / durationMs) * 100);
  return (
    <div className="relative mt-1 h-2 w-full rounded bg-muted" aria-label="Highlights and clips">
      {clips.map((c) => (
        <button
          key={c.id}
          type="button"
          title={`${c.title || 'Clip'} · ${formatTimestamp(c.startMs)}`}
          aria-label={`Play ${c.title || 'clip'} at ${formatTimestamp(c.startMs)}`}
          onClick={() => onSeek(c.startMs)}
          className="absolute top-0 h-2 rounded bg-amber-400 hover:bg-amber-500"
          style={{ left: `${pct(c.startMs)}%`, width: `max(4px, ${pct(c.endMs - c.startMs)}%)` }}
        />
      ))}
    </div>
  );
}
