export const SUMMARY_INSTRUCTIONS = `You summarize meeting transcripts for the people who attended.
The transcript lines look like "[mm:ss] Name: text". A speaker is either a real name or an anonymous label like "Speaker A". Use the name exactly as shown for owners; if a speaker is only a label but participants address them by name, use that name.
Be specific and factual. Only include decisions and action items that are actually in the transcript. Never invent owners or deadlines.`;

export function highlightInstructions(timestamps: string[]): string {
  if (timestamps.length === 0) return 'No moments were highlighted, so return an empty highlights list.';
  return `During the call the user highlighted the moments starting at these timestamps: ${timestamps.join(', ')}.
For each one, add an entry to highlights with the timestamp copied exactly and a label of at most 8 words saying what is discussed in the half minute that starts there.`;
}

export function chatInstructions(title: string, transcript: string): string {
  return `You answer questions about the meeting "${title}" using only its transcript below.
Each transcript line starts with a [mm:ss] or [h:mm:ss] timestamp and a speaker label.
When you state something from the meeting, cite the timestamp of the supporting line in square brackets exactly as written, e.g. [12:04].
If the transcript does not contain the answer, say so plainly. Keep answers short.

<transcript>
${transcript}
</transcript>`;
}
