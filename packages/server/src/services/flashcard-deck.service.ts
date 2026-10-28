import type { RequestContext } from '@studiq/authz';
import {
  accessibleFilter,
  check,
  Permission,
  resolveGroupResourceIds,
} from '@studiq/server/lib/authz';
import { wrapService } from '@studiq/server/lib/observability';
import { decodeCursor, encodeCursor } from '@studiq/server/lib/query-list';
import { failure, isFailure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { createClient } from '@studiq/server/lib/supabase/server';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type {
  BatchDeleteDeckInput,
  BulkCreateDeckInput,
  CreateDeckInput,
  Deck,
  DeckListQuery,
  UpdateDeckInput,
} from '@studiq/server/models/flashcard-deck.model';
import { groupService } from '@studiq/server/services/group.service';
import { limitsResolver } from '@studiq/server/services/limits.resolver';
import type { SupabaseClient } from '@supabase/supabase-js';

export class FlashcardDeckService {
  constructor(private createClient: () => Promise<SupabaseClient>) {}

  async create(data: CreateDeckInput, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const groupIds = data.visibility === 'group' ? [...new Set(data.groupIds ?? [])] : [];
    // A group-visible deck without a single share link is visible only to its creator (#139).
    if (data.visibility === 'group' && groupIds.length === 0) {
      return failure('UNPROCESSABLE_ENTITY');
    }
    if (groupIds.length > 0) {
      const shareCheck = await groupService.canShareContentToGroups(ctx, groupIds, ctx.activeOrgId);
      if (isFailure(shareCheck)) return failure(shareCheck.error);
      if (!shareCheck.data) return failure('FORBIDDEN');
    }

    const deckCount = await this.countOwned(supabase, ctx);
    await limitsResolver.checkLimit(ctx, 'max_decks', deckCount);

    if (data.flashcardIds && data.flashcardIds.length > 0) {
      const denied = await this.assertFlashcardsUpdatable(supabase, data.flashcardIds, ctx);
      if (denied) return denied;
    }

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

    if (groupIds.length > 0) {
      const rows = groupIds.map((gid) => ({
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

  /**
   * Guard for card ids being re-parented into a deck (create/update `flashcardIds`).
   * Re-parenting is a move, so every source card must be updatable by the caller.
   * Fails closed: unknown/unreadable ids are rejected rather than silently skipped.
   */
  private async assertFlashcardsUpdatable(
    supabase: SupabaseClient,
    ids: string[],
    ctx: RequestContext,
  ): Promise<ServiceResult<never> | null> {
    const { data: cards, error } = await supabase
      .from('flashcards')
      .select('id, created_by, organization_id')
      .in('id', ids);

    if (error) return toDbFailure(error);
    if (cards?.length !== new Set(ids).size) return failure('NOT_FOUND');

    for (const card of cards) {
      await check(ctx, Permission.FLASHCARD_UPDATE, card);
    }
    return null;
  }

  /**
   * Read-access guard for per-user deck preferences (suspended_decks).
   * Fails closed: unknown ids are NOT_FOUND, unreadable ids throw FORBIDDEN from `check`.
   */
  private async assertDecksReadable(
    supabase: SupabaseClient,
    ids: string[],
    ctx: RequestContext,
  ): Promise<ServiceResult<never> | null> {
    const { data: decks, error } = await supabase
      .from('flashcard_decks')
      .select('id, created_by, organization_id')
      .in('id', ids);

    if (error) return toDbFailure(error);
    if (decks?.length !== new Set(ids).size) return failure('NOT_FOUND');

    for (const deck of decks) {
      await check(ctx, Permission.DECK_READ, deck);
    }
    return null;
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
    if (filter._impossible)
      return success({ items: [], nextCursor: null, hasMore: false, total: 0 });

    const suspendedIds = await this.getSuspendedDeckIds(ctx);
    const includeSuspended = queryParams?.includeSuspended ?? false;

    // Owner filter on top of RBAC
    // Explicit group filter (#595): an extra AND on top of what RBAC already allows, so an
    // unknown/foreign group id can only narrow the result — never widen it.
    let groupIds: string[] | null = null;
    if (queryParams?.groups?.length) {
      groupIds = await resolveGroupResourceIds('deck', queryParams.groups);
      if (groupIds.length === 0)
        return success({ items: [], nextCursor: null, hasMore: false, total: 0 });
    }

    // Every filter (RBAC, suspended, owner, group, search) lives here and is shared by the page
    // query and the total-count query, so `total` always matches the visible set. The cursor and
    // limit are applied to the page query only, which keeps `total` stable while paging.
    const buildFiltered = (select: string, options?: { count: 'exact'; head: true }) => {
      let q = supabase.from('flashcard_decks').select(select, options);

      if (filter.or) q = q.or(filter.or);
      if (filter.created_by) q = q.eq('created_by', filter.created_by);
      if (filter.organization_id) q = q.eq('organization_id', filter.organization_id);

      // Exclude suspended decks by default
      if (!includeSuspended && suspendedIds.size > 0) {
        q = q.not('id', 'in', `(${[...suspendedIds].join(',')})`);
      }

      if (queryParams?.owner === 'mine') {
        q = q.eq('created_by', ctx.userId);
      }

      if (groupIds) q = q.in('id', groupIds);

      if (queryParams?.q) {
        q = q.or(`name.ilike.%${queryParams.q}%,description.ilike.%${queryParams.q}%`);
      }
      return q;
    };

    let query = buildFiltered('*, flashcard_count:flashcards(count), deck_groups(group_id)');
    const countQuery = buildFiltered('id', { count: 'exact', head: true });

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

    const [{ data, error }, { count, error: countError }] = await Promise.all([query, countQuery]);
    if (error) return toDbFailure(error);
    if (countError) return toDbFailure(countError);

    const rows = data as unknown as Array<Record<string, unknown>> | null;
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
      total: count ?? 0,
    } as { items: Deck[]; nextCursor: string | null; hasMore: boolean; total: number });
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
      { count: number }[] | undefined;
    const groups = (deck as Record<string, unknown>).deck_groups as
      { group_id: string }[] | undefined;
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

    // Suspension is a per-user preference (suspended_decks), so a suspend-only body
    // only needs read access. Anything that edits the deck itself — including a mixed
    // body and a no-op PUT — keeps the deck.update gate, so a reader can never borrow
    // this path to mutate content.
    const touchesDeckContent =
      data.name !== undefined ||
      data.description !== undefined ||
      data.visibility !== undefined ||
      data.groupIds !== undefined ||
      data.flashcardIds !== undefined;

    if (touchesDeckContent || data.suspended === undefined) {
      await check(ctx, Permission.DECK_UPDATE, existing);
    } else {
      await check(ctx, Permission.DECK_READ, existing);
    }

    // Share links only exist while the deck is group-visible. Deriving the target list from the
    // RESULTING visibility keeps `visibility` and `deck_groups` consistent for partial bodies:
    // a `{ visibility: 'personal' }` PUT must clear the links even though it omits `groupIds`.
    const effectiveVisibility = data.visibility ?? existing.visibility;
    const linksTouched = data.visibility !== undefined || data.groupIds !== undefined;
    const requestedGroupIds = !linksTouched
      ? null
      : effectiveVisibility !== 'group'
        ? [] // resulting visibility is personal → never keep links
        : data.groupIds !== undefined
          ? [...new Set(data.groupIds)]
          : null; // visibility stayed 'group' and no list was sent → keep existing links

    // The resulting state must never be "group" with zero links (#139):
    //  - an explicit empty list is always invalid;
    //  - "no list sent" is only valid when the deck already was group-visible
    //    (it inherits the links; this also blocks activating stale links on a personal deck).
    // Unsharing a group deck has to go through `{ visibility: 'personal' }`.
    const groupWithoutLinks =
      effectiveVisibility === 'group' &&
      (requestedGroupIds !== null
        ? requestedGroupIds.length === 0
        : existing.visibility !== 'group');
    if (groupWithoutLinks) return failure('UNPROCESSABLE_ENTITY');

    if (requestedGroupIds !== null && requestedGroupIds.length > 0) {
      // The link must belong to the CONTENT's org, not the caller's current UI org.
      // NULL-org content (legacy personal rows) falls back to the active org.
      const contentOrgId = existing.organization_id ?? ctx.activeOrgId ?? null;
      const shareCheck = await groupService.canShareContentToGroups(
        ctx,
        requestedGroupIds,
        contentOrgId,
      );
      if (isFailure(shareCheck)) return failure(shareCheck.error);
      if (!shareCheck.data) return failure('FORBIDDEN');
    }

    if (data.flashcardIds !== undefined && data.flashcardIds.length > 0) {
      const denied = await this.assertFlashcardsUpdatable(supabase, data.flashcardIds, ctx);
      if (denied) return denied;
    }

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

    if (requestedGroupIds !== null) {
      const { error: de } = await supabase.from('deck_groups').delete().eq('deck_id', id);
      if (de) return toDbFailure(de);
      if (requestedGroupIds.length > 0) {
        const rows = requestedGroupIds.map((gid) => ({ deck_id: id, group_id: gid }));
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
      // Bulk create cannot assign groups, so it can only produce personal decks (#139).
      visibility: 'personal',
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
    const deckIds = [...new Set(data.deckIds)];

    const guard = await this.assertDecksReadable(supabase, deckIds, ctx);
    if (guard) return guard;

    if (data.suspended) {
      const rows = deckIds.map((deckId) => ({
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
        .in('deck_id', deckIds);
      if (error) return toDbFailure(error);
    }

    return success({ updated: deckIds.length });
  }

  /**
   * Count the caller's decks for the limit check (#233): inside an org the count
   * is scoped to content owned by the caller **in that org**, so personal-space
   * decks never consume the org plan's capacity.
   */
  private async countOwned(supabase: SupabaseClient, ctx: RequestContext): Promise<number> {
    let query = supabase
      .from('flashcard_decks')
      .select('*', { count: 'exact', head: true })
      .eq('created_by', ctx.userId);

    if (ctx.activeOrgId) query = query.eq('organization_id', ctx.activeOrgId);

    const { count } = await query;
    return count ?? 0;
  }
}
export const flashcardDeckService = wrapService(
  new FlashcardDeckService(createClient),
  'flashcard-deck.service',
);
