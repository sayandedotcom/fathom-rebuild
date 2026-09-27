export const HIGHLIGHT_START = '⟦';
export const HIGHLIGHT_END = '⟧';

export function splitHighlights(snippet: string): { text: string; match: boolean }[] {
  const parts: { text: string; match: boolean }[] = [];
  const re = new RegExp(`${HIGHLIGHT_START}(.*?)${HIGHLIGHT_END}`, 'g');
  let last = 0;
  for (const m of snippet.matchAll(re)) {
    const index = m.index ?? 0;
    if (index > last) parts.push({ text: snippet.slice(last, index), match: false });
    parts.push({ text: m[1], match: true });
    last = index + m[0].length;
  }
  if (last < snippet.length) parts.push({ text: snippet.slice(last), match: false });
  return parts;
}
