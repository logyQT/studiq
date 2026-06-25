import { createClient } from '@/lib/supabase/server';
import { mapSupabaseError } from '@/lib/supabase-errors';
import { buildQueryFilter, Permission } from '@/lib/rbac';
import type { RequestContext } from '@/lib/request-context';
import type { SearchResult } from '@/server/models';
import { UserRole } from '@/types';

type RpcRow = {
  id: string;
  front: string;
  back: string;
  rank: number;
  deck_id: string | null;
  deck_name: string | null;
};

export class SearchService {
  async search(q: string, ctx: RequestContext, limit = 10): Promise<SearchResult[]> {
    const supabase = await createClient();

    const filter = await buildQueryFilter(ctx, Permission.FLASHCARD_READ);
    if (filter._impossible) return [];

    let p_user_id: string | null = null;
    let p_university_id: string | null = null;

    if ('created_by' in filter) {
      p_user_id = ctx.userId;
    } else if ('or' in filter) {
      p_user_id = ctx.userId;
      p_university_id = ctx.universityId;
    }

    const { data, error } = await supabase.rpc('search_flashcards', {
      search_query: q,
      result_limit: limit,
      p_user_id,
      p_university_id,
    });

    if (error) throw mapSupabaseError(error);

    const rows = data as RpcRow[] | null;
    if (!rows || rows.length === 0) return [];

    const basePath = ctx.role === UserRole.TEACHER ? '/edu' : '/app';

    const grouped = new Map<string, SearchResult>();

    for (const row of rows) {
      const existing = grouped.get(row.id);
      if (existing) {
        existing.rank = Math.max(existing.rank, row.rank);
        if (row.deck_id && !existing.decks.some((d) => d.id === row.deck_id)) {
          existing.decks.push({
            id: row.deck_id,
            name: row.deck_name ?? '',
            href: `${basePath}/flashcards/decks/${row.deck_id}/${row.id}`,
          });
        }
      } else {
        grouped.set(row.id, {
          type: 'flashcard',
          id: row.id,
          title: row.front,
          subtitle: row.back,
          rank: row.rank,
          decks: row.deck_id
            ? [
                {
                  id: row.deck_id,
                  name: row.deck_name ?? '',
                  href: `${basePath}/flashcards/decks/${row.deck_id}/${row.id}`,
                },
              ]
            : [],
        });
      }
    }

    return Array.from(grouped.values());
  }
}

export const searchService = new SearchService();
