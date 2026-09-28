import type { MeetingSource, MeetingStatus } from '@/lib/db/schema';

const INDEX: Record<Exclude<MeetingStatus, 'failed'>, number> = { in_meeting: 0, transcribing: 1, summarizing: 2, ready: 3 };

export function StatusStepper({ status, source }: { status: Exclude<MeetingStatus, 'failed'>; source: MeetingSource }) {
  const steps = [source === 'bot' ? 'In meeting' : 'Uploaded', 'Transcribing', 'Summarizing', 'Ready'];
  const current = INDEX[status];
  return (
    <ol className="flex flex-wrap items-center gap-2 text-sm">
      {steps.map((label, i) => (
        <li key={label} className="flex items-center gap-2">
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs ${
              i < current ? 'bg-primary text-primary-foreground' : i === current ? 'animate-pulse border-primary' : 'text-muted-foreground'
            }`}
          >
            {i + 1}
          </span>
          <span className={i <= current ? '' : 'text-muted-foreground'}>{label}</span>
          {i < steps.length - 1 && <span className="mx-1 h-px w-8 bg-border" />}
        </li>
      ))}
    </ol>
  );
}
