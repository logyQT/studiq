import { type NotesItem, parseNotes } from '@studiq/server/services/ai-utils';

/**
 * The notes a `generate_notes` tool output carries, or `null` when it carries none (the tool
 * answered with an error, or the transcript holds something else under that tool name). The same
 * parser the tool ran on its arguments, so a stored transcript is shaped like a fresh one.
 */
export function notesFromToolOutput(output: unknown): NotesItem | null {
  if (typeof output !== 'object' || output === null || !('type' in output)) return null;
  if (output.type !== 'notes') return null;
  const notes = parseNotes(output);
  return notes.sections.length === 0 && notes.summary === '' ? null : notes;
}

/**
 * The cards "make flashcards from these notes" starts from: the key terms, and the sections
 * (heading → body) when the notes have no terms. The result goes to the flashcard block as is, so
 * saving them is the one save path the chat already has.
 */
export function notesToFlashcards(notes: NotesItem): { front: string; back: string }[] {
  const fromTerms = notes.keyTerms
    .filter((entry) => entry.definition !== '')
    .map((entry) => ({ front: entry.term, back: entry.definition }));
  if (fromTerms.length > 0) return fromTerms;

  return notes.sections
    .filter((section) => section.heading !== '' && section.content !== '')
    .map((section) => ({ front: section.heading, back: section.content }));
}

/** The labels of the parts the notes do not carry a heading for, in the language of the UI. */
export interface NotesLabels {
  keyTerms: string;
  summary: string;
}

/** The notes as Markdown, for the clipboard. Empty parts leave no heading behind. */
export function notesToMarkdown(notes: NotesItem, labels: NotesLabels): string {
  const blocks: string[] = [];
  if (notes.title !== '') blocks.push(`# ${notes.title}`);

  for (const section of notes.sections) {
    const parts = [section.heading === '' ? '' : `## ${section.heading}`, section.content].filter(
      (part) => part !== '',
    );
    blocks.push(parts.join('\n\n'));
  }

  if (notes.keyTerms.length > 0) {
    const lines = notes.keyTerms.map((entry) =>
      entry.definition === '' ? `- **${entry.term}**` : `- **${entry.term}**: ${entry.definition}`,
    );
    blocks.push(`## ${labels.keyTerms}\n\n${lines.join('\n')}`);
  }

  if (notes.summary !== '') blocks.push(`## ${labels.summary}\n\n${notes.summary}`);

  return `${blocks.join('\n\n')}\n`;
}
