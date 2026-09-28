'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ClipItem } from '@/lib/clips/logic';
import { formatTimestamp } from '@/lib/transcript/format';

type Props = { clips: ClipItem[]; onSeek: (ms: number) => void; onChanged: () => void; onError: (message: string | null) => void };

function clipName(c: ClipItem): string {
  if (c.title) return c.title;
  return c.origin === 'live' && c.markMs !== null ? `Highlight at ${formatTimestamp(c.markMs)}` : 'Clip';
}

function statusText(c: ClipItem): string | null {
  if (c.startMs === null) return 'Lands after processing';
  if (c.status === 'pending' || c.status === 'cutting') return 'Preparing…';
  if (c.status === 'failed') return c.error ?? 'Failed';
  return null;
}

export function ClipsPanel({ clips, onSeek, onChanged, onError }: Props) {
  const [copied, setCopied] = useState<string | null>(null);
  if (clips.length === 0) {
    return <p className="text-sm text-muted-foreground">No clips yet. Select lines in the transcript to make one.</p>;
  }

  async function act(res: Promise<Response>, fallback: string) {
    onError(null);
    const r = await res;
    if (!r.ok) {
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      onError(data.error ?? fallback);
    }
    onChanged();
  }

  async function copyLink(c: ClipItem) {
    await navigator.clipboard.writeText(`${window.location.origin}/c/${c.shareToken}`);
    setCopied(c.id);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <ul className="space-y-2 text-sm">
      {clips.map((c) => (
        <li key={c.id} className="space-y-1 rounded border p-2">
          <div className="flex items-center gap-2">
            {c.startMs !== null ? (
              <button type="button" onClick={() => onSeek(c.startMs!)} className="font-mono text-xs text-muted-foreground hover:underline">
                {formatTimestamp(c.startMs)}–{formatTimestamp(c.endMs ?? c.startMs)}
              </button>
            ) : null}
            <span className="font-medium">{clipName(c)}</span>
            {c.origin === 'live' && <Badge variant="secondary">Highlight</Badge>}
          </div>
          {statusText(c) && <p className={c.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}>{statusText(c)}</p>}
          <div className="flex gap-2">
            {c.status === 'ready' && (
              <Button size="sm" variant="outline" onClick={() => copyLink(c)}>
                {copied === c.id ? 'Copied' : 'Copy link'}
              </Button>
            )}
            {c.status === 'failed' && c.startMs !== null && (
              <Button size="sm" variant="outline" onClick={() => act(fetch(`/api/clips/${c.id}/retry`, { method: 'POST' }), 'Could not retry the clip.')}>
                Retry
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (!window.confirm('Delete this clip? Its share link will stop working.')) return;
                void act(fetch(`/api/clips/${c.id}`, { method: 'DELETE' }), 'Could not delete the clip.');
              }}
            >
              Delete
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
