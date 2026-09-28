export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
export const MAX_DURATION_SEC = 2 * 60 * 60;
// There is no auth, so this caps how many paid Recall bots can run at once.
export const MAX_ACTIVE_BOTS = 3;

export function validateMediaFile(file: { type: string; size: number }): string | null {
  if (!/^(audio|video)\//.test(file.type)) return 'Please choose an audio or video file.';
  if (file.size === 0) return 'That file is empty.';
  if (file.size > MAX_UPLOAD_BYTES) return 'Files larger than 500MB are not supported.';
  return null;
}

export function clampDurationSec(elapsedMs: number): number {
  return Math.min(MAX_DURATION_SEC, Math.max(0, Math.round(elapsedMs / 1000)));
}

export function exceedsMaxDuration(durationSec: number | null | undefined): boolean {
  return durationSec != null && durationSec > MAX_DURATION_SEC;
}
