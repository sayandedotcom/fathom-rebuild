import { MEETING_TEMPLATES, type MeetingTemplate, TEMPLATE_LABELS } from '@/lib/templates';

export function TemplateSelect({
  value,
  onChange,
  disabled,
}: {
  value: MeetingTemplate;
  onChange: (t: MeetingTemplate) => void;
  disabled?: boolean;
}) {
  return (
    <select
      aria-label="Meeting template"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as MeetingTemplate)}
      className="h-8 rounded-lg border bg-background px-2 text-sm"
    >
      {MEETING_TEMPLATES.map((t) => (
        <option key={t} value={t}>
          {TEMPLATE_LABELS[t]}
        </option>
      ))}
    </select>
  );
}
