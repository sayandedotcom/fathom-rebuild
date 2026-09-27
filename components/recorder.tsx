'use client';

import { upload } from '@vercel/blob/client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { createMeeting, defaultTitle } from '@/lib/client/media';
import { MAX_DURATION_SEC, MAX_UPLOAD_BYTES } from '@/lib/limits';
import { formatTimestamp } from '@/lib/transcript/format';

type Session = {
  recorder: MediaRecorder;
  streams: MediaStream[];
  ctx: AudioContext;
  chunks: Blob[];
  startedAt: number;
  timer: number;
};

export function Recorder() {
  const router = useRouter();
  const [captureTab, setCaptureTab] = useState(true);
  const [title, setTitle] = useState('');
  const [phase, setPhase] = useState<'idle' | 'recording' | 'uploading'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState(0);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const session = useRef<Session | null>(null);

  useEffect(
    () => () => {
      const s = session.current;
      if (!s) return;
      clearInterval(s.timer);
      s.streams.forEach((st) => st.getTracks().forEach((t) => t.stop()));
      void s.ctx.close();
    },
    [],
  );

  async function start() {
    setError(null);
    setWarning(null);
    let mic: MediaStream;
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError('Microphone access was denied. Allow it in your browser’s site settings and try again.');
      return;
    }
    const streams = [mic];
    if (captureTab) {
      try {
        const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        if (display.getAudioTracks().length === 0) {
          display.getTracks().forEach((t) => t.stop());
          setWarning('The shared screen had no audio. Share a browser tab and turn on “Share tab audio” to capture other participants. Recording your mic only.');
        } else {
          streams.push(display);
        }
      } catch {
        setWarning('Tab sharing was cancelled. Recording your mic only.');
      }
    }

    const ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    for (const s of streams) ctx.createMediaStreamSource(new MediaStream(s.getAudioTracks())).connect(dest);
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    const recorder = new MediaRecorder(dest.stream, { mimeType });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.start(1000);
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const sec = Math.floor((Date.now() - startedAt) / 1000);
      setElapsed(sec);
      if (sec >= MAX_DURATION_SEC) void stop();
    }, 500);
    session.current = { recorder, streams, ctx, chunks, startedAt, timer };
    setElapsed(0);
    setPhase('recording');
  }

  async function stop() {
    const s = session.current;
    if (!s) return;
    session.current = null;
    clearInterval(s.timer);
    await new Promise<void>((resolve) => {
      s.recorder.onstop = () => resolve();
      s.recorder.stop();
    });
    s.streams.forEach((st) => st.getTracks().forEach((t) => t.stop()));
    await s.ctx.close();

    const blob = new Blob(s.chunks, { type: 'audio/webm' });
    const durationSec = Math.round((Date.now() - s.startedAt) / 1000);
    if (blob.size === 0) {
      setPhase('idle');
      return setError('Nothing was recorded.');
    }
    if (blob.size > MAX_UPLOAD_BYTES) {
      setPhase('idle');
      return setError('The recording is larger than 500MB.');
    }
    setPhase('uploading');
    try {
      const uploaded = await upload(`recordings/${Date.now()}.webm`, blob, {
        access: 'public',
        handleUploadUrl: '/api/blob/upload',
        contentType: 'audio/webm',
        multipart: blob.size > 50 * 1024 * 1024,
        onUploadProgress: (p) => setProgress(p.percentage),
      });
      const id = await createMeeting({ title: title.trim() || defaultTitle(), audioUrl: uploaded.url, durationSec });
      router.push(`/meetings/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setPhase('idle');
    }
  }

  return (
    <div className="space-y-4">
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Meeting title (optional)" disabled={phase !== 'idle'} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={captureTab} onChange={(e) => setCaptureTab(e.target.checked)} disabled={phase !== 'idle'} />
        Also capture a meeting tab (Google Meet, Zoom web…). Use headphones to avoid echo.
      </label>
      {phase === 'idle' && <Button onClick={start}>Start recording</Button>}
      {phase === 'recording' && (
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-2 font-mono">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-600" />
            {formatTimestamp(elapsed * 1000)}
          </span>
          <Button variant="destructive" onClick={stop}>Stop and transcribe</Button>
        </div>
      )}
      {phase === 'uploading' && <Progress value={progress} />}
      {warning && <p className="text-sm text-amber-600">{warning}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
