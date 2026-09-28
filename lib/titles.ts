export const UNTITLED = 'Untitled meeting';

export function resolveCreateTitle(input: string): { title: string; titleIsAuto: boolean } {
  const title = input.trim();
  return title ? { title, titleIsAuto: false } : { title: UNTITLED, titleIsAuto: true };
}

export function pickAutoTitle(isAuto: boolean, summaryTitle: string | undefined): string | null {
  const title = summaryTitle?.trim();
  return isAuto && title ? title.slice(0, 200) : null;
}
