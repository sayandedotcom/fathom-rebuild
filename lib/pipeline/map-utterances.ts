import type { NewUtterance } from '../db/schema';

export type RawUtterance = { speaker: string; start: number; end: number; text: string };

export function mapUtterances(meetingId: string, input: RawUtterance[] | null | undefined): NewUtterance[] {
  return (input ?? [])
    .filter((u) => u.text.trim() !== '')
    .map((u) => ({
      meetingId,
      speaker: u.speaker,
      startMs: Math.round(u.start),
      endMs: Math.round(u.end),
      text: u.text.trim(),
    }));
}
