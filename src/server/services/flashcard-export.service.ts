import { createClient } from '@/lib/supabase/server';
import { flashcardService } from '@/server/services';
import type { RequestContext } from '@/lib/request-context';
import type { Flashcard } from '@/types/flashcards';

type FlashcardWithAssignments = Flashcard & {
  flashcard_topic_assignments: Array<{ topic_id: string }>;
  flashcard_deck_assignments: Array<{ deck_id: string }>;
};

export class FlashcardExportService {
  async exportCsv(
    ctx: RequestContext,
    filters?: { deckIds?: string[]; ids?: string[] },
  ): Promise<string> {
    const supabase = await createClient();

    const listFilters: { deckIds?: string[] } = {};
    if (filters?.deckIds && filters.deckIds.length > 0) {
      listFilters.deckIds = filters.deckIds;
    }

    const allFlashcards: FlashcardWithAssignments[] = [];
    let cursor: string | undefined;

    do {
      const result = await flashcardService.list(ctx, {
        ...listFilters,
        limit: 100,
        cursor,
      });
      allFlashcards.push(...(result.items as unknown as FlashcardWithAssignments[]));
      cursor = result.hasMore && result.nextCursor ? result.nextCursor : undefined;
    } while (cursor);

    const flashcards = allFlashcards;

    const filtered = filters?.ids && filters.ids.length > 0
      ? flashcards.filter((fc) => filters.ids!.includes(fc.id))
      : flashcards;

    const topicIds = new Set<string>();
    const deckIds = new Set<string>();

    for (const fc of filtered) {
      for (const t of fc.flashcard_topic_assignments ?? []) {
        topicIds.add(t.topic_id);
      }
      for (const d of fc.flashcard_deck_assignments ?? []) {
        deckIds.add(d.deck_id);
      }
    }

    const [topicResult, deckResult] = await Promise.all([
      topicIds.size > 0
        ? supabase.from('flashcard_topics').select('id, name').in('id', Array.from(topicIds))
        : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
      deckIds.size > 0
        ? supabase.from('flashcard_decks').select('id, name').in('id', Array.from(deckIds))
        : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
    ]);

    const topicMap = new Map(topicResult.data?.map((t) => [t.id, t.name]) ?? []);
    const deckMap = new Map(deckResult.data?.map((d) => [d.id, d.name]) ?? []);

    const header = 'front,back,topic,deck';
    const rows = filtered.map((fc) => {
      const front = this.escapeCsv(fc.front);
      const back = this.escapeCsv(fc.back);
      const topic = this.escapeCsv(
        (fc.flashcard_topic_assignments ?? [])
          .map((t) => topicMap.get(t.topic_id) ?? '')
          .filter(Boolean)
          .join('; '),
      );
      const deck = this.escapeCsv(
        (fc.flashcard_deck_assignments ?? [])
          .map((d) => deckMap.get(d.deck_id) ?? '')
          .filter(Boolean)
          .join('; '),
      );
      return `${front},${back},${topic},${deck}`;
    });

    return `\uFEFF${header}\n${rows.join('\n')}`;
  }

  private escapeCsv(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}

export const flashcardExportService = new FlashcardExportService();
