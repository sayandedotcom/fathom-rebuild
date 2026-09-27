'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { parseCitations } from '@/lib/chat/citations';

const SUGGESTIONS = ['What were the main decisions?', 'What are my action items?', 'Summarize the disagreements.'];

export function ChatPanel({ meetingId, onSeek }: { meetingId: string; onSeek: (ms: number) => void }) {
  const [input, setInput] = useState('');
  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({ api: `/api/meetings/${meetingId}/chat` }),
  });
  const busy = status === 'submitted' || status === 'streaming';

  function send(text: string) {
    if (!text.trim() || busy) return;
    void sendMessage({ text });
    setInput('');
  }

  return (
    <div className="flex h-[60vh] flex-col rounded-md border">
      <div className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
        {messages.length === 0 && (
          <div className="space-y-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" onClick={() => send(s)} className="block w-full rounded border p-2 text-left hover:bg-muted">
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === 'user' ? 'ml-8 rounded bg-muted p-2' : 'mr-4 whitespace-pre-wrap'}>
            {m.parts.map((part, i) =>
              part.type === 'text' ? (
                <span key={i}>
                  {m.role === 'assistant'
                    ? parseCitations(part.text).map((seg, j) =>
                        seg.type === 'cite' ? (
                          <button key={j} type="button" onClick={() => onSeek(seg.ms)} className="mx-0.5 rounded bg-muted px-1 font-mono text-xs hover:underline">
                            {seg.label}
                          </button>
                        ) : (
                          <span key={j}>{seg.text}</span>
                        ),
                      )
                    : part.text}
                </span>
              ) : null,
            )}
          </div>
        ))}
        {status === 'submitted' && <p className="text-muted-foreground">Thinking…</p>}
        {error && <p className="text-destructive">Something went wrong. Try again.</p>}
      </div>
      <form
        className="flex gap-2 border-t p-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about this meeting…" />
        <Button type="submit" disabled={busy || !input.trim()}>
          Ask
        </Button>
      </form>
    </div>
  );
}
