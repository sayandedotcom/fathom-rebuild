'use client';

import { upload } from '@vercel/blob/client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { TemplateSelect } from '@/components/template-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { createMeeting, readDuration } from '@/lib/client/media';
import type { MeetingTemplate } from '@/lib/templates';
import { MAX_DURATION_SEC, validateMediaFile } from '@/lib/limits';

const MULTIPART_THRESHOLD = 50 * 1024 * 1024;

export function Uploader() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [template, setTemplate] = useState<MeetingTemplate>('general');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = progress !== null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setError(null);
    const invalid = validateMediaFile(file);
    if (invalid) return setError(invalid);
    try {
      const durationSec = await readDuration(file);
      if (durationSec !== null && durationSec > MAX_DURATION_SEC) {
        return setError('Recordings longer than 2 hours are not supported.');
      }
      setProgress(0);
      const blob = await upload(`meetings/${file.name}`, file, {
        access: 'public',
        handleUploadUrl: '/api/blob/upload',
        multipart: file.size > MULTIPART_THRESHOLD,
        onUploadProgress: (p) => setProgress(p.percentage),
      });
      const id = await createMeeting({ title: title.trim(), audioUrl: blob.url, durationSec, source: 'upload', template });
      router.push(`/meetings/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setProgress(null);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Meeting title (optional)" disabled={busy} />
      <TemplateSelect value={template} onChange={setTemplate} disabled={busy} />
      <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 text-sm text-muted-foreground hover:bg-muted/50">
        <input
          type="file"
          accept="audio/*,video/*"
          className="sr-only"
          disabled={busy}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        {file ? `${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)` : 'Choose an audio or video file (max 500MB, 2h)'}
      </label>
      {progress !== null && <Progress value={progress} />}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={!file || busy}>
        {busy ? 'Uploading…' : 'Upload and transcribe'}
      </Button>
    </form>
  );
}
