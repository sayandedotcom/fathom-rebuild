'use client';

import { formatTimestamp } from '@/lib/transcript/format';

const SPEAKER_COLORS = ['text-blue-600', 'text-emerald-600', 'text-amber-600', 'text-fuchsia-600', 'text-cyan-600', 'text-rose-600'];

export function speakerColor(speaker: string): string {
  return SPEAKER_COLORS[speaker.charCodeAt(0) % SPEAKER_COLORS.length];
}

export type Line = { id: number; speaker: string; startMs: number; text: string };

export function TranscriptView({ lines, activeId, onSeek }: { lines: Line[]; activeId: number | null; onSeek: (ms: number) => void }) {
  if (lines.length === 0) return <p className="text-sm text-muted-foreground">No speech was detected.</p>;
  return (
    <ol className="space-y-3 text-sm">
      {lines.map((l) => (
        <li key={l.id} id={`u-${l.id}`} className={`rounded p-2 ${l.id === activeId ? 'bg-muted' : ''}`}>
          <button type="button" onClick={() => onSeek(l.startMs)} className="mr-2 font-mono text-xs text-muted-foreground hover:underline">
            {formatTimestamp(l.startMs)}
          </button>
          <span className={`font-medium ${speakerColor(l.speaker)}`}>Speaker {l.speaker}</span>
          <p className="mt-1 leading-relaxed">{l.text}</p>
        </li>
      ))}
    </ol>
  );
}
