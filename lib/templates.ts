export const MEETING_TEMPLATES = ['general', 'sales', 'one_on_one', 'standup', 'interview'] as const;
export type MeetingTemplate = (typeof MEETING_TEMPLATES)[number];
