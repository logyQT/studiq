export interface FlashcardItem {
  front: string;
  back: string;
  topic?: string;
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
    front: String(c.front ?? ''),
    back: String(c.back ?? ''),
    topic: c.topic ? String(c.topic) : undefined,
  }));
}
