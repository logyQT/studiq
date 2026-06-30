import { AppError } from '@/lib/errors';
import { log } from '@/lib/logger';
import { buildQueryFilter, checkPermission, Permission, shouldSetUniversityId } from '@/lib/rbac';
import type { RequestContext } from '@/lib/request-context';
import { createClient } from '@/lib/supabase/server';
import { mapSupabaseError } from '@/lib/supabase-errors';
import type {
  BatchDeleteDeckInput,
  BulkCreateDeckInput,
  CreateDeckInput,
  DeckListQuery,
  UpdateDeckInput,
} from '@/server/models';
import type { Deck } from '@/types/flashcards';

export class FlashcardDeckService {
  async create(data: CreateDeckInput, ctx: RequestContext) {
    const supabase = await createClient();
    const organizationId = (await shouldSetUniversityId(ctx, Permission.DECK_CREATE))
      ? ctx.activeOrgId
      : null;

    const { data: deck, error } = await supabase
      .from('flashcard_decks')
      .insert({
        name: data.name,
        description: data.description ?? null,
        created_by: ctx.userId,
        organization_id: organizationId,
      })
      .select()
      .single();

    if (error) throw mapSupabaseError(error);
    if (!deck) throw new AppError('NOT_FOUND');

    if (data.flashcardIds && data.flashcardIds.length > 0) {
      const assignments = data.flashcardIds.map((flashcardId) => ({
        deck_id: deck.id,
        flashcard_id: flashcardId,
      }));
      await supabase.from('flashcard_deck_assignments').insert(assignments);
    }

    return this.getById(deck.id, ctx);
  }

  private async getSuspendedDeckIds(ctx: RequestContext): Promise<Set<string>> {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('suspended_decks')
      .select('deck_id')
      .eq('user_id', ctx.userId);
    log.trace.info('getSuspendedDeckIds', {
      metadata: { traceId: ctx.traceId, count: (data ?? []).length, errorCode: error?.code },
    });
    return new Set((data ?? []).map((r) => r.deck_id));
  }

  async list(ctx: RequestContext, queryParams?: Partial<DeckListQuery>) {
    const supabase = await createClient();

    const filter = await buildQueryFilter(ctx, Permission.DECK_READ, 'deck');
    if (filter._impossible) return { items: [], nextCursor: null, hasMore: false };

    const suspendedIds = await this.getSuspendedDeckIds(ctx);
    const includeSuspended = queryParams?.includeSuspended ?? false;

    let query = supabase
      .from('flashcard_decks')
      .select('*, flashcard_count:flashcard_deck_assignments(count)');

    // Apply RBAC filter
    if (filter.or) {
      query = query.or(filter.or);
    } else if (filter.created_by) {
      query = query.eq('created_by', filter.created_by);
    }

    // Exclude suspended decks by default
    if (!includeSuspended && suspendedIds.size > 0) {
      query = query.not('id', 'in', `(${[...suspendedIds].join(',')})`);
    }

    // Apply owner filter on top of RBAC
    if (queryParams?.owner && queryParams.owner !== 'all') {
      if (queryParams.owner === 'mine') {
        query = query.eq('created_by', ctx.userId);
      } else if (queryParams.owner === 'org') {
        const hasOrgScope = filter.or || !filter.created_by;
        if (hasOrgScope && ctx.activeOrgId) {
          query = query.neq('created_by', ctx.userId).eq('organization_id', ctx.activeOrgId);
        } else {
          return { items: [], nextCursor: null, hasMore: false };
        }
      } else if (queryParams.owner === 'shared') {
        return { items: [], nextCursor: null, hasMore: false };
      }
    }

    // Apply search
    if (queryParams?.q) {
      query = query.or(`name.ilike.%${queryParams.q}%,description.ilike.%${queryParams.q}%`);
    }

    // Apply sorting with tie-breaker
    const sortBy = queryParams?.sortBy ?? 'created_at';
    const sortOrder = queryParams?.sortOrder ?? 'desc';
    const sortAsc = sortOrder === 'asc';
    query = query.order(sortBy, { ascending: sortAsc }).order('id');

    // Cursor-based pagination
    const pageSize = Math.min(queryParams?.limit ?? 24, 100);
    query = query.limit(pageSize + 1);

    if (queryParams?.cursor) {
      const decoded = JSON.parse(Buffer.from(queryParams.cursor, 'base64').toString('utf-8'));
      const cursorVal = decoded.v;
      const cursorId = decoded.id;
      const op = sortAsc ? 'gt' : 'lt';
      query = query.or(
        `${sortBy}.${op}.${cursorVal},and(${sortBy}.eq.${cursorVal},id.gt.${cursorId})`,
      );
    }

    const { data, error } = await query;
    if (error) throw mapSupabaseError(error);

    const rows = data as Array<Record<string, unknown>> | null;
    const hasMore = (rows?.length ?? 0) > pageSize;
    const sliced = hasMore ? rows!.slice(0, pageSize) : (rows ?? []);
    const items = sliced.map((item) => {
      const countArr = item.flashcard_count as { count: number }[] | undefined;
      return {
        ...item,
        flashcard_count: countArr?.[0]?.count ?? 0,
        suspended: suspendedIds.has(item.id as string),
      };
    });
    const nextCursor = hasMore
      ? Buffer.from(
          JSON.stringify({
            v: sliced[sliced.length - 1][sortBy],
            id: sliced[sliced.length - 1].id,
          }),
        ).toString('base64')
      : null;

    return {
      items: items as unknown as Deck[],
      nextCursor,
      hasMore,
    } as { items: Deck[]; nextCursor: string | null; hasMore: boolean };
  }

  async getById(id: string, ctx: RequestContext) {
    const supabase = await createClient();

    log.trace.info('getById/start', { metadata: { traceId: ctx.traceId, deckId: id } });

    const suspendedIds = await this.getSuspendedDeckIds(ctx);

    const filter = await buildQueryFilter(ctx, Permission.DECK_READ, 'deck');
    let query = supabase
      .from('flashcard_decks')
      .select('*, flashcard_count:flashcard_deck_assignments(count)')
      .eq('id', id);

    if (filter._impossible) throw new AppError('NOT_FOUND');
    if (filter.or) {
      query = query.or(filter.or);
    } else if (filter.created_by) {
      query = query.eq('created_by', filter.created_by);
    }

    const { data: deck, error } = await query.single();
    log.trace.info('getById/result', {
      metadata: { traceId: ctx.traceId, found: !!deck, errorCode: error?.code },
    });
    if (error || !deck) throw new AppError('NOT_FOUND');

    const countArr = (deck as Record<string, unknown>).flashcard_count as
      | { count: number }[]
      | undefined;
    return {
      ...deck,
      flashcard_count: countArr?.[0]?.count ?? 0,
      suspended: suspendedIds.has(id),
    } as unknown as Deck;
  }

  async update(id: string, data: UpdateDeckInput, ctx: RequestContext) {
    const supabase = await createClient();

    log.trace.info('update/start', {
      metadata: { traceId: ctx.traceId, deckId: id, hasSuspended: 'suspended' in data },
    });

    const { data: existing, error: fetchError } = await supabase
      .from('flashcard_decks')
      .select('*')
      .eq('id', id)
      .single();

    log.trace.info('update/fetch', {
      metadata: { traceId: ctx.traceId, found: !!existing, errorCode: fetchError?.code },
    });
    if (fetchError || !existing) throw new AppError('NOT_FOUND');
    await checkPermission(ctx, Permission.DECK_UPDATE, existing);
    log.trace.info('update/permission_ok', { metadata: { traceId: ctx.traceId } });

    if (data.name !== undefined || data.description !== undefined) {
      const updateFields: Record<string, unknown> = {};
      if (data.name !== undefined) updateFields.name = data.name;
      if (data.description !== undefined) updateFields.description = data.description;

      const { data: deck, error } = await supabase
        .from('flashcard_decks')
        .update(updateFields)
        .eq('id', id)
        .select()
        .single();

      log.trace.info('update/update_done', {
        metadata: { traceId: ctx.traceId, hasDeck: !!deck, errorCode: error?.code },
      });
      if (error) throw mapSupabaseError(error);
      if (!deck) throw new AppError('NOT_FOUND');
    }

    if (data.flashcardIds !== undefined) {
      await supabase.from('flashcard_deck_assignments').delete().eq('deck_id', id);
      if (data.flashcardIds.length > 0) {
        const assignments = data.flashcardIds.map((flashcardId) => ({
          deck_id: id,
          flashcard_id: flashcardId,
        }));
        await supabase.from('flashcard_deck_assignments').insert(assignments);
      }
    }

    if (data.suspended !== undefined) {
      if (data.suspended) {
        await supabase
          .from('suspended_decks')
          .upsert({ user_id: ctx.userId, deck_id: id }, { onConflict: 'user_id,deck_id' });
      } else {
        await supabase.from('suspended_decks').delete().eq('user_id', ctx.userId).eq('deck_id', id);
      }
    }

    log.trace.info('update/before_getById', { metadata: { traceId: ctx.traceId } });
    return this.getById(id, ctx);
  }

  async delete(id: string, ctx: RequestContext) {
    const supabase = await createClient();

    const { data: existing, error: fetchError } = await supabase
      .from('flashcard_decks')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !existing) throw new AppError('NOT_FOUND');
    await checkPermission(ctx, Permission.DECK_DELETE, existing);

    const { error } = await supabase.from('flashcard_decks').delete().eq('id', id);

    if (error) throw mapSupabaseError(error);
  }

  async bulkCreate(data: BulkCreateDeckInput, ctx: RequestContext) {
    const supabase = await createClient();
    const organizationId = (await shouldSetUniversityId(ctx, Permission.DECK_CREATE))
      ? ctx.activeOrgId
      : null;

    const decks = data.decks.map((d) => ({
      name: d.name,
      description: d.description ?? null,
      created_by: ctx.userId,
      organization_id: organizationId,
    }));

    const { data: created, error } = await supabase
      .from('flashcard_decks')
      .insert(decks)
      .select('*');

    if (error) throw mapSupabaseError(error);
    return created;
  }

  async batchDelete(data: BatchDeleteDeckInput, ctx: RequestContext) {
    const supabase = await createClient();

    const { data: decks, error: fetchError } = await supabase
      .from('flashcard_decks')
      .select('*')
      .in('id', data.ids);

    if (fetchError) throw mapSupabaseError(fetchError);
    if (!decks || decks.length === 0) throw new AppError('NOT_FOUND');

    for (const deck of decks) {
      await checkPermission(ctx, Permission.DECK_DELETE, deck);
    }

    const { error } = await supabase.from('flashcard_decks').delete().in('id', data.ids);

    if (error) throw mapSupabaseError(error);

    return { deleted: data.ids.length };
  }

  async batchToggleSuspend(data: { deckIds: string[]; suspended: boolean }, ctx: RequestContext) {
    const supabase = await createClient();

    if (data.suspended) {
      const rows = data.deckIds.map((deckId) => ({
        user_id: ctx.userId,
        deck_id: deckId,
      }));
      const { error } = await supabase.from('suspended_decks').upsert(rows, {
        onConflict: 'user_id,deck_id',
        ignoreDuplicates: true,
      });
      if (error) throw mapSupabaseError(error);
    } else {
      const { error } = await supabase
        .from('suspended_decks')
        .delete()
        .eq('user_id', ctx.userId)
        .in('deck_id', data.deckIds);
      if (error) throw mapSupabaseError(error);
    }

    return { updated: data.deckIds.length };
  }
}

export const flashcardDeckService = new FlashcardDeckService();
