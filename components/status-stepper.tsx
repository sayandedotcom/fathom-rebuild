import type { MeetingStatus } from '@/lib/db/schema';

const STEPS = ['Uploaded', 'Transcribing', 'Summarizing', 'Ready'] as const;
const INDEX: Record<Exclude<MeetingStatus, 'failed'>, number> = { transcribing: 1, summarizing: 2, ready: 3 };

export function StatusStepper({ status }: { status: Exclude<MeetingStatus, 'failed'> }) {
  const current = INDEX[status];
  return (
    <ol className="flex items-center gap-2 text-sm">
      {STEPS.map((label, i) => (
        <li key={label} className="flex items-center gap-2">
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs ${
              i < current ? 'bg-primary text-primary-foreground' : i === current ? 'animate-pulse border-primary' : 'text-muted-foreground'
            }`}
          >
            {i + 1}
          </span>
          <span className={i <= current ? '' : 'text-muted-foreground'}>{label}</span>
          {i < STEPS.length - 1 && <span className="mx-1 h-px w-8 bg-border" />}
        </li>
      ))}
    </ol>
  );
}
