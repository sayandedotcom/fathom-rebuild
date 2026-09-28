'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { timestampToMs } from '@/lib/chat/citations';
import { summaryToMarkdown } from '@/lib/summary-markdown';
import type { Summary } from '@/lib/summary-schema';

export function SummaryView({ title, summary, onSeek }: { title: string; summary: Summary; onSeek: (ms: number) => void }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(summaryToMarkdown(title, summary));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="space-y-5 text-sm">
      <Button size="sm" variant="outline" onClick={copy}>
        {copied ? 'Copied' : 'Copy as Markdown'}
      </Button>
      <p className="leading-relaxed">{summary.overview}</p>
      {(summary.keyMoments ?? []).length > 0 && (
        <Section title="Key moments">
          <ul className="space-y-1">
            {(summary.keyMoments ?? []).map((k, i) => {
              const ms = timestampToMs(k.timestamp);
              return (
                <li key={i}>
                  {ms !== null ? (
                    <button type="button" onClick={() => onSeek(ms)} className="mr-2 font-mono text-xs text-muted-foreground hover:underline">{k.timestamp}</button>
                  ) : null}
                  {k.label}
                </li>
              );
            })}
          </ul>
        </Section>
      )}
      <Section title="Action items">
        {summary.actionItems.length === 0 ? (
          <p className="text-muted-foreground">No action items.</p>
        ) : (
          <ul className="space-y-2">
            {summary.actionItems.map((a, i) => (
              <li key={i} className="flex gap-2">
                <input type="checkbox" className="mt-1" aria-label={a.task} />
                <span>
                  {a.task}
                  {(a.owner || a.due) && (
                    <span className="text-muted-foreground"> — {[a.owner, a.due].filter(Boolean).join(', ')}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Key points">
        <ul className="list-disc space-y-1 pl-5">{summary.keyPoints.map((p, i) => <li key={i}>{p}</li>)}</ul>
      </Section>
      {(summary.sections ?? [])
        .filter((s) => s.items.length > 0)
        .map((s) => (
          <Section key={s.heading} title={s.heading}>
            <ul className="list-disc space-y-1 pl-5">{s.items.map((item, i) => <li key={i}>{item}</li>)}</ul>
          </Section>
        ))}
      {summary.decisions.length > 0 && (
        <Section title="Decisions">
          <ul className="list-disc space-y-1 pl-5">{summary.decisions.map((d, i) => <li key={i}>{d}</li>)}</ul>
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="font-semibold">{title}</h3>
      {children}
    </section>
  );
}
