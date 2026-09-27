'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChatPanel } from '@/components/chat-panel';
import { Badge } from '@/components/ui/badge';
import { SummaryView } from '@/components/summary-view';
import { type Line, TranscriptView } from '@/components/transcript-view';
import type { MeetingStatus } from '@/lib/db/schema';
import type { Summary } from '@/lib/summary-schema';
import { formatTimestamp } from '@/lib/transcript/format';

export type MeetingViewProps = {
  meeting: {
    id: string;
    title: string;
    status: MeetingStatus;
    error: string | null;
    audioUrl: string;
    durationSec: number | null;
    createdAt: string;
    summary: Summary | null;
  };
  lines: Line[];
  initialSeekMs: number | null;
};

const STATUS_TEXT: Record<MeetingStatus, string> = {
  transcribing: 'Transcribing… this usually takes a fraction of the recording length.',
  summarizing: 'Writing the summary…',
  ready: 'Ready',
  failed: 'Failed',
};

function useStatusPolling(id: string, status: MeetingStatus) {
  const router = useRouter();
  useEffect(() => {
    if (status !== 'transcribing' && status !== 'summarizing') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const res = await fetch(`/api/meetings/${id}`, { cache: 'no-store' });
        if (res.ok) {
          const data = (await res.json()) as { status: MeetingStatus };
          if (data.status !== status) {
            router.refresh();
            return;
          }
        }
      } catch {
        // network blip: keep polling
      }
      if (!cancelled) timer = setTimeout(poll, 3000);
    }
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id, status, router]);
}

export function MeetingView({ meeting, lines, initialSeekMs }: MeetingViewProps) {
  useStatusPolling(meeting.id, meeting.status);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [currentMs, setCurrentMs] = useState(0);

  const seek = useCallback((ms: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = ms / 1000;
    void audio.play().catch(() => {});
  }, []);

  const activeId = useMemo(() => lines.findLast((l) => l.startMs <= currentMs)?.id ?? null, [lines, currentMs]);

  // Metadata can finish loading before hydration, so check readyState instead of relying on onLoadedMetadata.
  const initialSeekDone = useRef(false);
  useEffect(() => {
    const audio = audioRef.current;
    if (initialSeekMs === null || !audio || initialSeekDone.current) return;
    const apply = () => {
      initialSeekDone.current = true;
      audio.currentTime = initialSeekMs / 1000;
      setCurrentMs(initialSeekMs);
      const target = lines.findLast((l) => l.startMs <= initialSeekMs);
      if (target) document.getElementById(`u-${target.id}`)?.scrollIntoView({ block: 'center' });
    };
    if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) apply();
    else audio.addEventListener('loadedmetadata', apply, { once: true });
    return () => audio.removeEventListener('loadedmetadata', apply);
  }, [initialSeekMs, lines]);

  const inProgress = meeting.status === 'transcribing' || meeting.status === 'summarizing';

  return (
    <main className="mx-auto max-w-7xl space-y-4 p-6">
      <header className="space-y-1">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{meeting.title}</h1>
          <Badge variant={meeting.status === 'failed' ? 'destructive' : 'secondary'}>{meeting.status}</Badge>
        </div>
        <p className="text-sm text-muted-foreground" suppressHydrationWarning>
          {new Date(meeting.createdAt).toLocaleString()}
          {meeting.durationSec !== null && ` · ${formatTimestamp(meeting.durationSec * 1000)}`}
        </p>
      </header>

      {inProgress && <p className="rounded-md border p-4 text-sm">{STATUS_TEXT[meeting.status]}</p>}
      {meeting.status === 'failed' && (
        <p className="rounded-md border border-destructive p-4 text-sm text-destructive">{meeting.error ?? 'Processing failed.'}</p>
      )}

      <audio
        ref={audioRef}
        src={meeting.audioUrl}
        controls
        preload="metadata"
        className="w-full"
        onTimeUpdate={(e) => setCurrentMs(e.currentTarget.currentTime * 1000)}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr_380px]">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Summary</h2>
          {meeting.summary ? <SummaryView summary={meeting.summary} /> : <p className="text-sm text-muted-foreground">Not available yet.</p>}
        </section>
        <section className="space-y-3 lg:max-h-[75vh] lg:overflow-y-auto">
          <h2 className="text-lg font-semibold">Transcript</h2>
          {lines.length > 0 || meeting.status === 'ready' ? (
            <TranscriptView lines={lines} activeId={activeId} onSeek={seek} />
          ) : (
            <p className="text-sm text-muted-foreground">Not available yet.</p>
          )}
        </section>
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Ask about this meeting</h2>
          {meeting.status === 'ready' ? (
            <ChatPanel meetingId={meeting.id} />
          ) : (
            <p className="text-sm text-muted-foreground">Chat is available once processing finishes.</p>
          )}
        </section>
      </div>
    </main>
  );
}
