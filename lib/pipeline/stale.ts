export const SUMMARIZING_TIMEOUT_MS = 6 * 60 * 1000;

export function isStaleSummarizing(status: string, updatedAt: Date, now: Date): boolean {
  return status === 'summarizing' && now.getTime() - updatedAt.getTime() > SUMMARIZING_TIMEOUT_MS;
}

// A bot meeting in `transcribing` without an AssemblyAI id is mid-copy; if that function died, this detects it.
export function isStaleCopy(updatedAt: Date, now: Date): boolean {
  return now.getTime() - updatedAt.getTime() > SUMMARIZING_TIMEOUT_MS;
}
