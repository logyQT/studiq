import { createClient } from '@/lib/supabase/server';
import { mapSupabaseError } from '@/lib/supabase-errors';
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

    const { data, error } = await supabase.rpc('search_flashcards', {
      search_query: q,
      result_limit: limit,
    });

    if (error) throw mapSupabaseError(error);

    const rows = data as RpcRow[] | null;
    if (!rows || rows.length === 0) return [];

    const basePath = ctx.role === UserRole.TEACHER ? '/edu' : '/app';

    return rows.map((row) => ({
      type: 'flashcard' as const,
      id: row.id,
      title: row.front,
      subtitle: row.back,
      href: row.deck_id
        ? `${basePath}/flashcards/deck/${row.deck_id}?highlight=${row.id}`
        : '#',
      context: row.deck_name ?? undefined,
      rank: row.rank,
    }));
  }
}

export const searchService = new SearchService();
