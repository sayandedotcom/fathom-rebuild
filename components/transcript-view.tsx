'use client';

import { useState } from 'react';
import { formatTimestamp } from '@/lib/transcript/format';
import { speakerName } from '@/lib/transcript/speakers';

const SPEAKER_COLORS = ['text-blue-600', 'text-emerald-600', 'text-amber-600', 'text-fuchsia-600', 'text-cyan-600', 'text-rose-600'];

export function speakerColor(speaker: string): string {
  return SPEAKER_COLORS[speaker.charCodeAt(0) % SPEAKER_COLORS.length];
}

export type Line = { id: number; speaker: string; startMs: number; text: string };

type Props = {
  lines: Line[];
  activeId: number | null;
  onSeek: (ms: number) => void;
  speakerNames: Record<string, string>;
  onRename: (label: string, name: string) => void;
};

export function TranscriptView({ lines, activeId, onSeek, speakerNames, onRename }: Props) {
  if (lines.length === 0) return <p className="text-sm text-muted-foreground">No speech was detected.</p>;
  return (
    <ol className="space-y-3 text-sm">
      {lines.map((l) => (
        <li key={l.id} id={`u-${l.id}`} className={`rounded p-2 ${l.id === activeId ? 'bg-muted' : ''}`}>
          <button type="button" onClick={() => onSeek(l.startMs)} className="mr-2 font-mono text-xs text-muted-foreground hover:underline">
            {formatTimestamp(l.startMs)}
          </button>
          <SpeakerLabel label={l.speaker} names={speakerNames} onRename={onRename} />
          <p className="mt-1 leading-relaxed">{l.text}</p>
        </li>
      ))}
    </ol>
  );
}

function SpeakerLabel({ label, names, onRename }: { label: string; names: Record<string, string>; onRename: (label: string, name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  if (editing) {
    return (
      <input
        autoFocus
        value={value}
        maxLength={60}
        aria-label={`Name for Speaker ${label}`}
        placeholder={`Speaker ${label}`}
        className="rounded border px-1 text-sm"
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            setEditing(false);
            onRename(label, value.trim());
          }
          if (e.key === 'Escape') setEditing(false);
        }}
      />
    );
  }
  return (
    <button
      type="button"
      title="Rename this speaker"
      onClick={() => {
        setValue(names[label] ?? '');
        setEditing(true);
      }}
      className={`font-medium hover:underline ${speakerColor(label)}`}
    >
      {speakerName(label, names)}
    </button>
  );
}
