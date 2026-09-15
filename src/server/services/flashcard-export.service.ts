import type { SupabaseClient } from '@supabase/supabase-js';
import { wrapService } from '@/lib/observability';
import type { RequestContext } from '@/lib/request-context';
import { failure, type ServiceResult, success } from '@/lib/service-result';
import { createClient } from '@/lib/supabase/server';
import type { Flashcard } from '@/server/models/flashcard.model';
import { flashcardService } from '@/server/services/flashcard.service';

type FlashcardWithAssignments = Flashcard & {
  flashcard_topic_assignments: Array<{ topic_id: string }>;
  deck_id?: string | null;
};

export class FlashcardExportService {
  constructor(private createClient: () => Promise<SupabaseClient>) {}

  async exportCsv(
    ctx: RequestContext,
    filters?: { deckIds?: string[]; ids?: string[] },
  ): Promise<ServiceResult<string>> {
    const supabase = await this.createClient();

    const listFilters: { deckIds?: string[] } = {};
    if (filters?.deckIds && filters.deckIds.length > 0) {
      listFilters.deckIds = filters.deckIds;
    }

    const allFlashcards: FlashcardWithAssignments[] = [];
    let cursor: string | undefined;

    do {
      const serviceResult = await flashcardService.list(ctx, {
        ...listFilters,
        limit: 100,
        cursor,
      });
      if (!serviceResult.success) return failure(serviceResult.error);
      const result = serviceResult.data as {
        items: FlashcardWithAssignments[];
        hasMore: boolean;
        nextCursor: string | null;
      };
      allFlashcards.push(...result.items);
      cursor = result.hasMore && result.nextCursor ? result.nextCursor : undefined;
    } while (cursor);

    const flashcards = allFlashcards;

    const filtered =
      filters?.ids && filters.ids.length > 0
        ? flashcards.filter((fc) => filters.ids!.includes(fc.id))
        : flashcards;

    const topicIds = new Set<string>();
    const deckIds = new Set<string>();

    for (const fc of filtered) {
      for (const t of fc.flashcard_topic_assignments ?? []) {
        topicIds.add(t.topic_id);
      }
      if (fc.deck_id) {
        deckIds.add(fc.deck_id);
      }
    }

    const [topicResult, deckResult] = await Promise.all([
      topicIds.size > 0
        ? supabase.from('topics').select('id, name').in('id', Array.from(topicIds))
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
      const deck = this.escapeCsv(fc.deck_id ? (deckMap.get(fc.deck_id) ?? '') : '');
      return `${front},${back},${topic},${deck}`;
    });

    return success(`\uFEFF${header}\n${rows.join('\n')}`);
  }

  private escapeCsv(value: string): string {
    if (
      value.includes(',') ||
      value.includes('"') ||
      value.includes('\n') ||
      value.includes('\r')
    ) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
export const flashcardExportService = wrapService(
  new FlashcardExportService(createClient),
  'flashcard-export.service',
);
