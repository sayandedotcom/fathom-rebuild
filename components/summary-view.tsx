import type { Summary } from '@/lib/summary-schema';

export function SummaryView({ summary }: { summary: Summary }) {
  return (
    <div className="space-y-5 text-sm">
      <p className="leading-relaxed">{summary.overview}</p>
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
