'use client';

import { useState } from 'react';
import { type ClipRange, rangeFromLines } from '@/lib/clips/logic';
import { formatTimestamp } from '@/lib/transcript/format';
import { speakerName } from '@/lib/transcript/speakers';

const SPEAKER_COLORS = ['text-blue-600', 'text-emerald-600', 'text-amber-600', 'text-fuchsia-600', 'text-cyan-600', 'text-rose-600'];

export function speakerColor(speaker: string): string {
  return SPEAKER_COLORS[speaker.charCodeAt(0) % SPEAKER_COLORS.length];
}

export type Line = { id: number; speaker: string; startMs: number; endMs: number; text: string };

type Props = {
  lines: Line[];
  activeId: number | null;
  onSeek: (ms: number) => void;
  speakerNames: Record<string, string>;
  onRename: (label: string, name: string) => void;
  clipLineIds: Set<number>;
  onSelectRange: (range: ClipRange | null) => void;
};

export function TranscriptView({ lines, activeId, onSeek, speakerNames, onRename, clipLineIds, onSelectRange }: Props) {
  if (lines.length === 0) return <p className="text-sm text-muted-foreground">No speech was detected.</p>;

  function selectedRange(): ClipRange | null {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return null;
    const lineId = (node: Node | null) => {
      const el = node instanceof Element ? node : node?.parentElement;
      const li = el?.closest('li[data-line-id]');
      return li ? Number(li.getAttribute('data-line-id')) : null;
    };
    const a = lineId(sel.anchorNode);
    const b = lineId(sel.focusNode);
    return a === null || b === null ? null : rangeFromLines(lines, a, b);
  }

  return (
    <ol className="space-y-3 text-sm" onMouseUp={() => onSelectRange(selectedRange())} onKeyUp={() => onSelectRange(selectedRange())}>
      {lines.map((l) => (
        <li
          key={l.id}
          id={`u-${l.id}`}
          data-line-id={l.id}
          className={`rounded p-2 ${l.id === activeId ? 'bg-muted' : ''} ${clipLineIds.has(l.id) ? 'border-l-4 border-amber-400 pl-3' : ''}`}
        >
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
