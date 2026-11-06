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
  return JSON.stringify(value) ?? '';
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
