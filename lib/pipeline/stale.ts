export const SUMMARIZING_TIMEOUT_MS = 6 * 60 * 1000;

export function isStaleSummarizing(status: string, updatedAt: Date, now: Date): boolean {
  return status === 'summarizing' && now.getTime() - updatedAt.getTime() > SUMMARIZING_TIMEOUT_MS;
}
