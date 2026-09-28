'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChatPanel } from '@/components/chat-panel';
import { StatusStepper } from '@/components/status-stepper';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { canRetry } from '@/lib/bot/outcome';
import { SummaryView } from '@/components/summary-view';
import { type Line, TranscriptView } from '@/components/transcript-view';
import type { MeetingSource, MeetingStatus } from '@/lib/db/schema';
import type { Summary } from '@/lib/summary-schema';
import { formatTimestamp } from '@/lib/transcript/format';

export type MeetingViewProps = {
  meeting: {
    id: string;
    title: string;
    status: MeetingStatus;
    error: string | null;
    audioUrl: string | null;
    source: MeetingSource;
    botStatus: string | null;
    durationSec: number | null;
    createdAt: string;
    summary: Summary | null;
  };
  lines: Line[];
  initialSeekMs: number | null;
};

const STATUS_TEXT: Record<MeetingStatus, string> = {
  in_meeting: 'The bot is in the meeting.',
  transcribing: 'Transcribing… this usually takes a fraction of the recording length.',
  summarizing: 'Writing the summary…',
  ready: 'Ready',
  failed: 'Failed',
};

const POLLED: MeetingStatus[] = ['in_meeting', 'transcribing', 'summarizing'];

function useStatusPolling(id: string, status: MeetingStatus, botStatus: string | null) {
  const router = useRouter();
  useEffect(() => {
    if (!POLLED.includes(status)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const res = await fetch(`/api/meetings/${id}`, { cache: 'no-store' });
        if (res.ok) {
          const data = (await res.json()) as { status: MeetingStatus; botStatus: string | null };
          if (data.status !== status || (data.botStatus ?? null) !== botStatus) {
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
  }, [id, status, botStatus, router]);
}

export function MeetingView({ meeting, lines, initialSeekMs }: MeetingViewProps) {
  useStatusPolling(meeting.id, meeting.status, meeting.botStatus);
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);

  async function retry() {
    setRetrying(true);
    await fetch(`/api/meetings/${meeting.id}/retry`, { method: 'POST' });
    setRetrying(false);
    router.refresh();
  }

  const [stopping, setStopping] = useState(false);
  async function stopBot() {
    setStopping(true);
    await fetch(`/api/meetings/${meeting.id}/stop-bot`, { method: 'POST' });
    setStopping(false);
    router.refresh();
  }
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

  const inProgress = POLLED.includes(meeting.status);

  return (
    <main className="mx-auto w-full max-w-7xl space-y-4 p-6">
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

      {inProgress && (
        <div className="space-y-2 rounded-md border p-4">
          <StatusStepper status={meeting.status as 'in_meeting' | 'transcribing' | 'summarizing'} source={meeting.source} />
          <p className="text-sm text-muted-foreground">
            {meeting.status === 'in_meeting' ? (meeting.botStatus ?? 'Joining the meeting…') : STATUS_TEXT[meeting.status]}
          </p>
          {meeting.status === 'in_meeting' && (
            <Button size="sm" variant="outline" onClick={stopBot} disabled={stopping}>
              {stopping ? 'Stopping…' : 'Stop recording'}
            </Button>
          )}
        </div>
      )}
      {meeting.status === 'failed' && (
        <div className="rounded-md border border-destructive p-4 text-sm text-destructive">
          <p>{meeting.error ?? 'Processing failed.'}</p>
          {canRetry(meeting) && (
            <Button size="sm" variant="outline" className="mt-2" onClick={retry} disabled={retrying}>
              {retrying ? 'Retrying…' : 'Retry'}
            </Button>
          )}
        </div>
      )}

      {meeting.audioUrl && (
        <div className="sticky top-0 z-10 bg-background py-2">
          <audio
            ref={audioRef}
            src={meeting.audioUrl}
            controls
            preload="metadata"
            className="w-full"
            onTimeUpdate={(e) => setCurrentMs(e.currentTarget.currentTime * 1000)}
          />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr_380px]">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Summary</h2>
          {meeting.summary ? <SummaryView title={meeting.title} summary={meeting.summary} onSeek={seek} /> : <p className="text-sm text-muted-foreground">Not available yet.</p>}
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
            <ChatPanel meetingId={meeting.id} onSeek={seek} />
          ) : (
            <p className="text-sm text-muted-foreground">Chat is available once processing finishes.</p>
          )}
        </section>
      </div>
    </main>
  );
}
