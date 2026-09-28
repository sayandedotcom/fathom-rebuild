export const NEW_MEETING_TABS = ['upload', 'record', 'bot'] as const;
export type NewMeetingTab = (typeof NEW_MEETING_TABS)[number];

export function parseNewMeetingTab(tab: string | string[] | undefined): NewMeetingTab {
  return NEW_MEETING_TABS.find((t) => t === tab) ?? 'upload';
}
