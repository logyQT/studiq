import type { RequestContext } from '@studiq/authz';
import type { SupabaseClient } from '@supabase/supabase-js';
import { accessibleFilter, check, Permission } from '@/lib/authz';
import { wrapService } from '@/lib/observability';
import { decodeCursor, encodeCursor } from '@/lib/query-list';
import { failure, type ServiceResult, success } from '@/lib/service-result';
import { createClient } from '@/lib/supabase/server';
import { toDbFailure } from '@/lib/supabase-errors';
import type {
  BatchDeleteDeckInput,
  BulkCreateDeckInput,
  CreateDeckInput,
  Deck,
  DeckListQuery,
  UpdateDeckInput,
} from '@/server/models/flashcard-deck.model';
import { limitsResolver } from '@/server/services/limits.resolver';

export class FlashcardDeckService {
  constructor(private createClient: () => Promise<SupabaseClient>) {}

  async create(data: CreateDeckInput, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const { count: deckCount } = await supabase
      .from('flashcard_decks')
      .select('*', { count: 'exact', head: true })
      .eq('created_by', ctx.userId);
    await limitsResolver.checkLimit(ctx, 'max_decks', deckCount ?? 0);

    const { data: deck, error } = await supabase
      .from('flashcard_decks')
      .insert({
        name: data.name,
        description: data.description ?? null,
        created_by: ctx.userId,
        organization_id: ctx.activeOrgId,
        visibility: data.visibility ?? 'personal',
      })
      .select()
      .single();

    if (error && error.code !== 'PGRST116') return toDbFailure(error);
    if (!deck) return failure('NOT_FOUND');

    if ((data as any).visibility === 'group' && (data as any).groupIds?.length) {
      const { groupService } = await import('@/server/services/group.service');
      let authorized = false;
      for (const gid of (data as any).groupIds) {
        if (await groupService.isTeacherInGroup(ctx, gid)) {
          authorized = true;
          break;
        }
      }
      if (!authorized) return failure('FORBIDDEN');

      const rows = (data as any).groupIds.map((gid: string) => ({
        deck_id: deck.id,
        group_id: gid,
      }));
      const { error: ae } = await supabase.from('deck_groups').insert(rows);
      if (ae) return toDbFailure(ae);
    }

    if (data.flashcardIds && data.flashcardIds.length > 0) {
      const { error: fcError } = await supabase
        .from('flashcards')
        .update({ deck_id: deck.id })
        .in('id', data.flashcardIds);
      if (fcError) return toDbFailure(fcError);
    }

    return this.getById(deck.id, ctx);
  }

  private async getSuspendedDeckIds(ctx: RequestContext): Promise<Set<string>> {
    const supabase = await this.createClient();
    const { data } = await supabase
      .from('suspended_decks')
      .select('deck_id')
      .eq('user_id', ctx.userId);
    return new Set((data ?? []).map((r) => r.deck_id));
  }

  async list(
    ctx: RequestContext,
    queryParams?: Partial<DeckListQuery>,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const filter = await accessibleFilter(ctx, Permission.DECK_READ, 'deck');
    if (filter._impossible) return success({ items: [], nextCursor: null, hasMore: false });

    const suspendedIds = await this.getSuspendedDeckIds(ctx);
    const includeSuspended = queryParams?.includeSuspended ?? false;

    let query = supabase
      .from('flashcard_decks')
      .select('*, flashcard_count:flashcards(count), deck_groups(group_id)');

    if (filter.or) query = query.or(filter.or);
    if (filter.created_by) query = query.eq('created_by', filter.created_by);
    if (filter.organization_id) query = query.eq('organization_id', filter.organization_id);

    // Exclude suspended decks by default
    if (!includeSuspended && suspendedIds.size > 0) {
      query = query.not('id', 'in', `(${[...suspendedIds].join(',')})`);
    }

    // Apply owner filter on top of RBAC
    if (queryParams?.owner && queryParams.owner !== 'all') {
      if (queryParams.owner === 'mine') {
        query = query.eq('created_by', ctx.userId);
      } else if (queryParams.owner === 'group') {
        if (ctx.activeOrgId) {
          query = query
            .neq('created_by', ctx.userId)
            .eq('organization_id', ctx.activeOrgId)
            .eq('visibility', 'group');
        } else {
          return success({ items: [], nextCursor: null, hasMore: false });
        }
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
      const { v: cursorVal, id: cursorId } = decodeCursor(queryParams.cursor);
      const op = sortAsc ? 'gt' : 'lt';
      query = query.or(
        `${sortBy}.${op}.${cursorVal},and(${sortBy}.eq.${cursorVal},id.gt.${cursorId})`,
      );
    }

    const { data, error } = await query;
    if (error) return toDbFailure(error);

    const rows = data as Array<Record<string, unknown>> | null;
    const hasMore = (rows?.length ?? 0) > pageSize;
    const sliced = hasMore ? rows!.slice(0, pageSize) : (rows ?? []);
    const items = sliced.map((item) => {
      const countArr = item.flashcard_count as { count: number }[] | undefined;
      const groups = item.deck_groups as { group_id: string }[] | undefined;
      return {
        ...item,
        flashcard_count: countArr?.[0]?.count ?? 0,
        groupIds: groups?.map((g) => g.group_id) ?? [],
        suspended: suspendedIds.has(item.id as string),
      };
    });
    const nextCursor = hasMore
      ? encodeCursor(sliced[sliced.length - 1][sortBy], sliced[sliced.length - 1].id)
      : null;

    return success({
      items: items as unknown as Deck[],
      nextCursor,
      hasMore,
    } as { items: Deck[]; nextCursor: string | null; hasMore: boolean });
  }

  async getById(id: string, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const suspendedIds = await this.getSuspendedDeckIds(ctx);

    const filter = await accessibleFilter(ctx, Permission.DECK_READ, 'deck');
    if (filter._impossible) return failure('NOT_FOUND');

    let query = supabase
      .from('flashcard_decks')
      .select('*, flashcard_count:flashcards(count), deck_groups(group_id)')
      .eq('id', id);

    if (filter.or) query = query.or(filter.or);
    if (filter.created_by) query = query.eq('created_by', filter.created_by);
    if (filter.organization_id) query = query.eq('organization_id', filter.organization_id);

    const { data: deck, error } = await query.single();
    if (error || !deck) return failure('NOT_FOUND');

    const countArr = (deck as Record<string, unknown>).flashcard_count as
      | { count: number }[]
      | undefined;
    const groups = (deck as Record<string, unknown>).deck_groups as
      | { group_id: string }[]
      | undefined;
    return success({
      ...deck,
      flashcard_count: countArr?.[0]?.count ?? 0,
      groupIds: groups?.map((g) => g.group_id) ?? [],
      suspended: suspendedIds.has(id),
    } as unknown as Deck);
  }

  async update(
    id: string,
    data: UpdateDeckInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const { data: existing, error: fetchError } = await supabase
      .from('flashcard_decks')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') return toDbFailure(fetchError);
    if (!existing) return failure('NOT_FOUND');
    await check(ctx, Permission.DECK_UPDATE, existing);

    const updateFields: Record<string, unknown> = {};
    if (data.name !== undefined) updateFields.name = data.name;
    if (data.description !== undefined) updateFields.description = data.description;
    if (data.visibility !== undefined) updateFields.visibility = data.visibility;

    if (Object.keys(updateFields).length > 0) {
      const { data: deck, error } = await supabase
        .from('flashcard_decks')
        .update(updateFields)
        .eq('id', id)
        .select()
        .single();

      if (error && error.code !== 'PGRST116') return toDbFailure(error);
      if (!deck) return failure('NOT_FOUND');

      if (data.visibility !== undefined && data.visibility !== existing.visibility) {
        const { data: assignedFlashcards } = await supabase
          .from('flashcards')
          .select('id')
          .eq('deck_id', id);

        const flashcardIds = assignedFlashcards?.map((f) => f.id) ?? [];
        if (flashcardIds.length > 0) {
          await supabase
            .from('flashcards')
            .update({ visibility: data.visibility })
            .in('id', flashcardIds);
        }
      }
    }

    if ((data as any).groupIds !== undefined) {
      const { error: de } = await supabase.from('deck_groups').delete().eq('deck_id', id);
      if (de) return toDbFailure(de);
      if ((data as any).groupIds.length > 0) {
        const rows = (data as any).groupIds.map((gid: string) => ({ deck_id: id, group_id: gid }));
        const { error: ae } = await supabase.from('deck_groups').insert(rows);
        if (ae) return toDbFailure(ae);
      }
    }

    if (data.flashcardIds !== undefined) {
      // First unset deck_id for all flashcards currently in this deck
      await supabase.from('flashcards').update({ deck_id: null }).eq('deck_id', id);
      // Then set deck_id for the specified flashcards
      if (data.flashcardIds.length > 0) {
        const { error: fcError } = await supabase
          .from('flashcards')
          .update({ deck_id: id })
          .in('id', data.flashcardIds);
        if (fcError) return toDbFailure(fcError);
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

    return this.getById(id, ctx);
  }

  async delete(id: string, ctx: RequestContext): Promise<ServiceResult<void>> {
    const supabase = await this.createClient();

    const { data: existing, error: fetchError } = await supabase
      .from('flashcard_decks')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') return toDbFailure(fetchError);
    if (!existing) return failure('NOT_FOUND');
    await check(ctx, Permission.DECK_DELETE, existing);

    const { error } = await supabase.from('flashcard_decks').delete().eq('id', id);

    if (error) return toDbFailure(error);

    return success(undefined);
  }

  async bulkCreate(
    data: BulkCreateDeckInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();
    const decks = data.decks.map((d) => ({
      name: d.name,
      description: d.description ?? null,
      created_by: ctx.userId,
      organization_id: ctx.activeOrgId,
      visibility: d.visibility ?? 'personal',
    }));

    const { data: created, error } = await supabase
      .from('flashcard_decks')
      .insert(decks)
      .select('*');

    if (error) return toDbFailure(error);
    return success(created);
  }

  async batchDelete(
    data: BatchDeleteDeckInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const { data: decks, error: fetchError } = await supabase
      .from('flashcard_decks')
      .select('*')
      .in('id', data.ids);

    if (fetchError) return toDbFailure(fetchError);
    if (!decks || decks.length === 0) return failure('NOT_FOUND');

    for (const deck of decks) {
      await check(ctx, Permission.DECK_DELETE, deck);
    }

    const { error } = await supabase.from('flashcard_decks').delete().in('id', data.ids);

    if (error) return toDbFailure(error);

    return success({ deleted: data.ids.length });
  }

  async batchToggleSuspend(
    data: { deckIds: string[]; suspended: boolean },
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    if (data.suspended) {
      const rows = data.deckIds.map((deckId) => ({
        user_id: ctx.userId,
        deck_id: deckId,
      }));
      const { error } = await supabase.from('suspended_decks').upsert(rows, {
        onConflict: 'user_id,deck_id',
        ignoreDuplicates: true,
      });
      if (error) return toDbFailure(error);
    } else {
      const { error } = await supabase
        .from('suspended_decks')
        .delete()
        .eq('user_id', ctx.userId)
        .in('deck_id', data.deckIds);
      if (error) return toDbFailure(error);
    }

    return success({ updated: data.deckIds.length });
  }
}
export const flashcardDeckService = wrapService(
  new FlashcardDeckService(createClient),
  'flashcard-deck.service',
);
