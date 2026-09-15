import type { SupabaseClient } from '@supabase/supabase-js';
import { accessibleFilter, Permission } from '@/lib/authz';
import { wrapService } from '@/lib/observability';
import type { RequestContext } from '@/lib/request-context';
import { type ServiceResult, success } from '@/lib/service-result';
import { createClient } from '@/lib/supabase/server';
import { toDbFailure } from '@/lib/supabase-errors';
import type { SearchResult } from '@/server/models/search.model';
import { AccountType } from '@/types';

type RpcRow = {
  id: string;
  front: string;
  back: string;
  rank: number;
  deck_id: string | null;
  deck_name: string | null;
};

export class SearchService {
  constructor(private createClient: () => Promise<SupabaseClient>) {}

  async search(q: string, ctx: RequestContext, limit = 10): Promise<ServiceResult<SearchResult[]>> {
    const supabase = await this.createClient();

    const filter = await accessibleFilter(ctx, Permission.FLASHCARD_READ, 'flashcard');
    if (filter._impossible) return success([]);

    let p_user_id: string | null = null;
    let p_organization_id: string | null = null;

    // Construct search RPC params based on access filter
    if (filter.created_by) {
      p_user_id = ctx.userId;
    } else if (filter.or) {
      p_user_id = ctx.userId;
      p_organization_id = ctx.activeOrgId;
    }

    const { data, error } = await supabase.rpc('search_flashcards', {
      search_query: q,
      result_limit: limit,
      p_user_id,
      p_organization_id,
    });

    if (error) return toDbFailure(error);

    const rows = data as RpcRow[] | null;
    if (!rows || rows.length === 0) return success([]);

    const basePath = ctx.accountType === AccountType.EDUCATOR ? '/edu' : '/app';

    const grouped = new Map<string, SearchResult>();

    for (const row of rows) {
      const existing = grouped.get(row.id);
      if (existing) {
        existing.rank = Math.max(existing.rank, row.rank);
        if (row.deck_id && !existing.decks.some((d) => d.id === row.deck_id)) {
          existing.decks.push({
            id: row.deck_id,
            name: row.deck_name ?? '',
            href: `${basePath}/flashcards/${row.deck_id}/${row.id}`,
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
                  href: `${basePath}/flashcards/${row.deck_id}/${row.id}`,
                },
              ]
            : [],
        });
      }
    }

    return success(Array.from(grouped.values()));
  }
}
export const searchService = wrapService(new SearchService(createClient), 'search.service');
