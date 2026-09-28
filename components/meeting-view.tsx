'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChatPanel } from '@/components/chat-panel';
import { ClipsPanel } from '@/components/clips-panel';
import { HighlightBar } from '@/components/highlight-bar';
import { MeetingHeader } from '@/components/meeting-header';
import { StatusStepper } from '@/components/status-stepper';
import { Button } from '@/components/ui/button';
import { BOT_TEXT, canRetry, isStoppingText } from '@/lib/bot/outcome';
import { type ClipItem, type ClipRange, linesInClips, visibleClips } from '@/lib/clips/logic';
import { SummaryView } from '@/components/summary-view';
import { type Line, TranscriptView } from '@/components/transcript-view';
import type { MeetingSource, MeetingStatus } from '@/lib/db/schema';
import type { Summary } from '@/lib/summary-schema';
import type { MeetingTemplate } from '@/lib/templates';
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
    speakerNames: Record<string, string>;
    template: MeetingTemplate;
  };
  lines: Line[];
  clips: ClipItem[];
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

function useStatusPolling(id: string, status: MeetingStatus, botStatus: string | null, busyClips: number) {
  const router = useRouter();
  useEffect(() => {
    if (!(POLLED.includes(status) || busyClips > 0)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const res = await fetch(`/api/meetings/${id}`, { cache: 'no-store' });
        if (res.ok) {
          const data = (await res.json()) as { status: MeetingStatus; botStatus: string | null; busyClips: number };
          if (data.status !== status || (data.botStatus ?? null) !== botStatus || data.busyClips !== busyClips) {
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
  }, [id, status, botStatus, busyClips, router]);
}

export function MeetingView({ meeting, lines, clips, initialSeekMs }: MeetingViewProps) {
  const busyClips = clips.filter((c) => c.startMs !== null && (c.status === 'pending' || c.status === 'cutting')).length;
  useStatusPolling(meeting.id, meeting.status, meeting.botStatus, busyClips);
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);

  const [actionError, setActionError] = useState<string | null>(null);
  async function renameSpeaker(label: string, name: string) {
    setActionError(null);
    const res = await fetch(`/api/meetings/${meeting.id}/speakers`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label, name }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setActionError(data.error ?? 'Could not rename the speaker.');
    }
    router.refresh();
  }

  async function retry() {
    setRetrying(true);
    await fetch(`/api/meetings/${meeting.id}/retry`, { method: 'POST' });
    setRetrying(false);
    router.refresh();
  }

  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  async function stopBot() {
    setStopping(true);
    setStopError(null);
    const res = await fetch(`/api/meetings/${meeting.id}/stop-bot`, { method: 'POST' });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setStopError(data.error ?? 'Could not stop the bot.');
    }
    setStopping(false);
    router.refresh();
  }
  // Once the call has ended or a stop is already under way, there is nothing left to stop.
  const canStop =
    meeting.status === 'in_meeting' && meeting.botStatus !== BOT_TEXT.processing && !isStoppingText(meeting.botStatus);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [currentMs, setCurrentMs] = useState(0);

  const seek = useCallback((ms: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = ms / 1000;
    void audio.play().catch(() => {});
  }, []);

  const activeId = useMemo(() => lines.findLast((l) => l.startMs <= currentMs)?.id ?? null, [lines, currentMs]);

  const shownClips = useMemo(() => visibleClips(clips, meeting.status), [clips, meeting.status]);
  const placed = useMemo(
    () => shownClips.flatMap((c) => (c.startMs !== null && c.endMs !== null ? [{ id: c.id, title: c.title, startMs: c.startMs, endMs: c.endMs }] : [])),
    [shownClips],
  );
  const clipLineIds = useMemo(() => linesInClips(lines, placed), [lines, placed]);

  const [highlightMsg, setHighlightMsg] = useState<string | null>(null);
  async function highlight() {
    setHighlightMsg(null);
    const res = await fetch(`/api/meetings/${meeting.id}/clips`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ origin: 'live' }),
    });
    const data = (await res.json().catch(() => ({}))) as { markMs?: number; error?: string };
    setHighlightMsg(res.ok && data.markMs !== undefined ? `Highlighted at ${formatTimestamp(data.markMs)}` : (data.error ?? 'Could not add the highlight.'));
    if (res.ok) router.refresh();
  }

  const [selection, setSelection] = useState<ClipRange | null>(null);
  const [clipping, setClipping] = useState(false);
  async function clipSelection() {
    if (!selection) return;
    setClipping(true);
    setActionError(null);
    const res = await fetch(`/api/meetings/${meeting.id}/clips`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ origin: 'manual', ...selection }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setActionError(data.error ?? 'Could not create the clip.');
    }
    window.getSelection()?.removeAllRanges();
    setSelection(null);
    setClipping(false);
    router.refresh();
  }

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
        <MeetingHeader meeting={meeting} onError={setActionError} />
        <p className="text-sm text-muted-foreground" suppressHydrationWarning>
          {new Date(meeting.createdAt).toLocaleString()}
          {meeting.durationSec !== null && ` · ${formatTimestamp(meeting.durationSec * 1000)}`}
        </p>
      </header>
      {actionError && <p className="text-sm text-destructive">{actionError}</p>}

      {inProgress && (
        <div className="space-y-2 rounded-md border p-4">
          <StatusStepper status={meeting.status as 'in_meeting' | 'transcribing' | 'summarizing'} source={meeting.source} />
          <p className="text-sm text-muted-foreground">
            {meeting.status === 'in_meeting' ? (meeting.botStatus ?? 'Joining the meeting…') : STATUS_TEXT[meeting.status]}
          </p>
          <div className="flex items-center gap-2">
            {canStop && (
              <Button size="sm" variant="outline" onClick={stopBot} disabled={stopping}>
                {stopping ? 'Stopping…' : 'Stop recording'}
              </Button>
            )}
            {meeting.status === 'in_meeting' && meeting.botStatus === BOT_TEXT.recording && (
              <Button size="sm" onClick={highlight}>
                Highlight
              </Button>
            )}
          </div>
          {highlightMsg && <p className="text-sm text-muted-foreground">{highlightMsg}</p>}
          {stopError && <p className="text-sm text-destructive">{stopError}</p>}
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
          <HighlightBar clips={placed} durationMs={meeting.durationSec === null ? null : meeting.durationSec * 1000} onSeek={seek} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr_380px]">
        <Panel title="Summary">
          {meeting.summary ? <SummaryView title={meeting.title} summary={meeting.summary} onSeek={seek} /> : <p className="text-sm text-muted-foreground">Not available yet.</p>}
          <div className="space-y-3 border-t pt-4">
            <h3 className="font-semibold">Clips</h3>
            <ClipsPanel clips={shownClips} onSeek={seek} onChanged={() => router.refresh()} onError={setActionError} />
          </div>
        </Panel>
        <Panel title="Transcript">
          {meeting.status === 'ready' && selection && (
            <div className="sticky top-0 z-10 flex items-center gap-2 bg-card py-1">
              <Button size="sm" onClick={clipSelection} disabled={clipping}>
                Clip {formatTimestamp(selection.startMs)}–{formatTimestamp(selection.endMs)}
              </Button>
            </div>
          )}
          {lines.length > 0 || meeting.status === 'ready' ? (
            <TranscriptView
              lines={lines}
              activeId={activeId}
              onSeek={seek}
              speakerNames={meeting.speakerNames}
              onRename={renameSpeaker}
              clipLineIds={clipLineIds}
              onSelectRange={setSelection}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Not available yet.</p>
          )}
        </Panel>
        <Panel title="Ask about this meeting" flush={meeting.status === 'ready'}>
          {meeting.status === 'ready' ? (
            <ChatPanel meetingId={meeting.id} onSeek={seek} />
          ) : (
            <p className="text-sm text-muted-foreground">Chat is available once processing finishes.</p>
          )}
        </Panel>
      </div>
    </main>
  );
}

// One card per column so Summary, Transcript and Ask read as three equal panes.
// `flush` drops the body padding and scrolling for children that manage their own (the chat).
function Panel({ title, flush = false, children }: { title: string; flush?: boolean; children: React.ReactNode }) {
  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card lg:h-[75vh]">
      <h2 className="border-b px-4 py-3 text-base font-semibold">{title}</h2>
      <div className={flush ? 'flex min-h-0 flex-1 flex-col' : 'min-h-0 flex-1 space-y-4 overflow-y-auto p-4'}>{children}</div>
    </section>
  );
}
