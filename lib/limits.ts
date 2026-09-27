export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
export const MAX_DURATION_SEC = 2 * 60 * 60;

export function validateMediaFile(file: { type: string; size: number }): string | null {
  if (!/^(audio|video)\//.test(file.type)) return 'Please choose an audio or video file.';
  if (file.size === 0) return 'That file is empty.';
  if (file.size > MAX_UPLOAD_BYTES) return 'Files larger than 500MB are not supported.';
  return null;
}
