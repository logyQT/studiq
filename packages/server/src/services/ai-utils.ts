export interface FlashcardItem {
  front: string;
  back: string;
  topic?: string;
}

/**
 * Model output is untrusted: coerce a field to text explicitly instead of
 * relying on `Object#toString` (`[object Object]`) for non-primitive values.
 */
function toText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  // `JSON.stringify` returns undefined for values with no JSON form (a bare
  // function/symbol), which the lib types do not admit.
  const json: unknown = JSON.stringify(value);
  return typeof json === 'string' ? json : '';
}

export function parseFlashcards(raw: unknown): FlashcardItem[] {
  let cards: unknown;
  if (typeof raw === 'string') {
    try {
      cards = JSON.parse(raw);
    } catch {
      cards = [];
    }
  } else {
    cards = raw;
  }
  return (Array.isArray(cards) ? cards : []).map((c: Record<string, unknown>) => ({
    front: toText(c.front),
    back: toText(c.back),
    topic: c.topic ? toText(c.topic) : undefined,
  }));
}

export interface NotesSection {
  heading: string;
  content: string;
}

export interface NotesTerm {
  term: string;
  definition: string;
}

/** Study notes as the chat shows them: ordered sections, key terms and a closing summary. */
export interface NotesItem {
  title: string;
  sections: NotesSection[];
  keyTerms: NotesTerm[];
  summary: string;
}

function recordsIn(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  const entries: unknown[] = value;
  const records: Record<string, unknown>[] = [];
  for (const entry of entries) {
    if (typeof entry === 'object' && entry !== null && !Array.isArray(entry)) {
      records.push(Object.fromEntries(Object.entries(entry)));
    }
  }
  return records;
}

/**
 * Model output is untrusted, and so is a stored transcript: the same function shapes the tool's
 * arguments on the server and the tool's output on the client. Anything that is not an object
 * gives empty notes, a section with neither a heading nor a body and a term without a name are
 * dropped, and every text is trimmed.
 */
export function parseNotes(raw: unknown): NotesItem {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      value = undefined;
    }
  }
  const record =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value))
      : {};

  const sections = recordsIn(record.sections)
    .map((section) => ({
      heading: toText(section.heading).trim(),
      content: toText(section.content).trim(),
    }))
    .filter((section) => section.heading !== '' || section.content !== '');

  const keyTerms = recordsIn(record.keyTerms)
    .map((entry) => ({
      term: toText(entry.term).trim(),
      definition: toText(entry.definition).trim(),
    }))
    .filter((entry) => entry.term !== '');

  return {
    title: toText(record.title).trim(),
    sections,
    keyTerms,
    summary: toText(record.summary).trim(),
  };
}
