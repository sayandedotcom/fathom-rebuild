const MEET_CODE = /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

export function isMeetUrl(input: string): boolean {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return false;
  }
  return url.protocol === 'https:' && url.hostname === 'meet.google.com' && MEET_CODE.test(url.pathname);
}
