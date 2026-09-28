'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { isMeetUrl } from '@/lib/bot/meet-url';
import { defaultTitle, startBot } from '@/lib/client/media';

export function BotJoiner() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [meetingUrl, setMeetingUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const url = meetingUrl.trim();
    if (!isMeetUrl(url)) return setError('Paste a Google Meet link like https://meet.google.com/abc-defg-hij.');
    setBusy(true);
    try {
      const id = await startBot({ title: title.trim() || defaultTitle(), meetingUrl: url });
      router.push(`/meetings/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the bot');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Meeting title (optional)" disabled={busy} />
      <Input
        value={meetingUrl}
        onChange={(e) => setMeetingUrl(e.target.value)}
        placeholder="https://meet.google.com/abc-defg-hij"
        inputMode="url"
        disabled={busy}
      />
      <p className="text-sm text-muted-foreground">
        “Fanthom Notetaker” asks to join. Admit it in Meet. It records until the call ends or you press Stop.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={busy || !meetingUrl.trim()}>
        {busy ? 'Sending…' : 'Send bot to meeting'}
      </Button>
    </form>
  );
}
