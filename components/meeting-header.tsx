'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Hint } from '@/components/hint';
import { TemplateSelect } from '@/components/template-select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { MeetingStatus } from '@/lib/db/schema';
import { statusLabel } from '@/lib/status-label';
import type { MeetingTemplate } from '@/lib/templates';

type HeaderMeeting = { id: string; title: string; status: MeetingStatus; template: MeetingTemplate };

export function MeetingHeader({ meeting, onError }: { meeting: HeaderMeeting; onError: (message: string | null) => void }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(meeting.title);

  const [deleting, setDeleting] = useState(false);
  async function remove() {
    if (!window.confirm('Delete this meeting? This removes the recording and transcript permanently.')) return;
    setDeleting(true);
    onError(null);
    const res = await fetch(`/api/meetings/${meeting.id}`, { method: 'DELETE' });
    if (res.ok) {
      router.push('/');
      router.refresh();
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    onError(data.error ?? 'Could not delete the meeting.');
    setDeleting(false);
  }

  async function patch(body: { title?: string; template?: MeetingTemplate }) {
    onError(null);
    const res = await fetch(`/api/meetings/${meeting.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      onError(data.error ?? 'Could not save the change.');
    }
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {editing ? (
        <input
          autoFocus
          value={title}
          maxLength={200}
          aria-label="Meeting title"
          className="min-w-0 flex-1 rounded border px-2 text-2xl font-semibold"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setEditing(false);
            if (e.key === 'Enter' && title.trim()) {
              setEditing(false);
              void patch({ title: title.trim() });
            }
          }}
        />
      ) : (
        <h1>
          <Hint label="Click to rename this meeting.">
            <button
              type="button"
              className="text-left text-2xl font-semibold hover:underline"
              onClick={() => {
                setTitle(meeting.title);
                setEditing(true);
              }}
            >
              {meeting.title}
            </button>
          </Hint>
        </h1>
      )}
      <Badge variant={meeting.status === 'failed' ? 'destructive' : 'secondary'}>{statusLabel(meeting.status)}</Badge>
      <TemplateSelect
        value={meeting.template}
        disabled={meeting.status !== 'ready'}
        onChange={(template) => void patch({ template })}
        hint={meeting.status === 'ready' ? 'Summary format. Changing it rewrites the summary in the new format.' : 'You can change the summary format once processing finishes.'}
      />
      <Hint wrap className="ml-auto inline-flex" label="Permanently delete this meeting with its recording, transcript and clips.">
        <Button size="sm" variant="outline" onClick={remove} disabled={deleting}>
          {deleting ? 'Deleting…' : 'Delete'}
        </Button>
      </Hint>
    </div>
  );
}
