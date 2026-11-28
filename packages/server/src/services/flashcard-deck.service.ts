import type { RequestContext } from '@studiq/authz';
import { dbCount, dbRows } from '@studiq/server/lib/supabase/rows';
import {
  accessibleFilter,
  check,
  Permission,
  resolveGroupResourceIds,
  shareAudienceToAuthorize,
} from '@studiq/server/lib/authz';
import { wrapService } from '@studiq/server/lib/observability';
import type {
  BatchDeleteDeckInput,
  BulkCreateDeckInput,
  CreateDeckInput,
  DeckListQuery,
  UpdateDeckInput,
} from '@studiq/server/models/flashcard-deck.model';
import {
  applyAccessFilter,
  EMPTY_PAGE,
  listFilters,
  pageParams,
  pageQuery,
  pickDefined,
  readPageWithTotal,
} from '@studiq/server/lib/query-list';
import type { FilterableBuilder } from '@studiq/server/lib/postgrest';
import { isImpossibleFilter } from '@studiq/server/lib/rbac-filter';
import { failure, isFailure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { planShareLinks } from '@studiq/server/lib/share-links';
import { createClient } from '@studiq/server/lib/supabase/server';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import { groupService } from '@studiq/server/services/group.service';
import { limitsResolver } from '@studiq/server/services/limits';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';

export class FlashcardDeckService {
  constructor(private clientFactory: () => Promise<SupabaseClient<Database>>) {}

  async create(data: CreateDeckInput, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.clientFactory();

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
    supabase: SupabaseClient<Database>,
    ids: string[],
    ctx: RequestContext,
  ): Promise<ServiceResult<never> | null> {
    const { data: cards, error } = await supabase
      .from('flashcards')
      .select('id, created_by, organization_id')
      .in('id', ids);

    if (error) return toDbFailure(error);
    const foundCards = dbRows(cards);
    if (foundCards.length !== new Set(ids).size) return failure('NOT_FOUND');

    for (const card of foundCards) {
      await check(ctx, Permission.FLASHCARD_UPDATE, card);
    }
    return null;
  }

  /**
   * Read-access guard for per-user deck preferences (suspended_decks).
   * Fails closed: unknown ids are NOT_FOUND, unreadable ids throw FORBIDDEN from `check`.
   */
  private async assertDecksReadable(
    supabase: SupabaseClient<Database>,
    ids: string[],
    ctx: RequestContext,
  ): Promise<ServiceResult<never> | null> {
    const { data: decks, error } = await supabase
      .from('flashcard_decks')
      .select('id, created_by, organization_id')
      .in('id', ids);

    if (error) return toDbFailure(error);
    const foundDecks = dbRows(decks);
    if (foundDecks.length !== new Set(ids).size) return failure('NOT_FOUND');

    for (const deck of foundDecks) {
      await check(ctx, Permission.DECK_READ, deck);
    }
    return null;
  }

  private async getSuspendedDeckIds(ctx: RequestContext): Promise<Set<string>> {
    const supabase = await this.clientFactory();
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
    const supabase = await this.clientFactory();

    const filter = await accessibleFilter(ctx, Permission.DECK_READ, 'deck');
    if (isImpossibleFilter(filter)) return success(EMPTY_PAGE);

    const suspendedIds = await this.getSuspendedDeckIds(ctx);
    const includeSuspended = queryParams?.includeSuspended ?? false;

    // Owner filter on top of RBAC
    // Explicit group filter (#595): an extra AND on top of what RBAC already allows, so an
    // unknown/foreign group id can only narrow the result — never widen it.
    let groupIds: string[] | null = null;
    if (queryParams?.groups?.length) {
      groupIds = await resolveGroupResourceIds('deck', queryParams.groups);
      if (groupIds.length === 0) return success(EMPTY_PAGE);
    }

    const scoped = listFilters(filter, {
      userId: ctx.userId,
      params: queryParams,
      groupIds: groupIds ?? undefined,
      searchColumns: ['name', 'description'],
    });
    const applyFilters = <T extends FilterableBuilder<T>>(q: T): T => {
      const filtered = scoped(q);
      // Exclude suspended decks by default
      return !includeSuspended && suspendedIds.size > 0
        ? filtered.not('id', 'in', `(${[...suspendedIds].join(',')})`)
        : filtered;
    };

    const paging = pageParams(queryParams, { sortBy: 'created_at', limit: 24 });

    return readPageWithTotal(
      pageQuery(
        applyFilters(
          supabase
            .from('flashcard_decks')
            .select('*, flashcard_count:flashcards(count), deck_groups(group_id)'),
        ),
        paging,
      ),
      applyFilters(supabase.from('flashcard_decks').select('id', { count: 'exact', head: true })),
      {
        ...paging,
        map: (item) => ({
          ...item,
          flashcard_count: dbCount(item.flashcard_count),
          // PostgREST does not order an embed, so sort here: the same share set must
          // come back in the same order on every read (#1557).
          groupIds: dbRows(item.deck_groups)
            .map((g) => g.group_id)
            .toSorted(),
          suspended: suspendedIds.has(item.id),
        }),
      },
    );
  }

  async getById(id: string, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.clientFactory();

    const suspendedIds = await this.getSuspendedDeckIds(ctx);

    const filter = await accessibleFilter(ctx, Permission.DECK_READ, 'deck');
    if (isImpossibleFilter(filter)) return failure('NOT_FOUND');

    const { data: deck, error } = await applyAccessFilter(
      supabase
        .from('flashcard_decks')
        .select('*, flashcard_count:flashcards(count), deck_groups(group_id)')
        .eq('id', id),
      filter,
    ).maybeSingle();
    if (error || !deck) return failure('NOT_FOUND');

    return success({
      ...deck,
      flashcard_count: dbCount(deck.flashcard_count),
      groupIds: dbRows(deck.deck_groups)
        .map((g) => g.group_id)
        .toSorted(),
      suspended: suspendedIds.has(id),
    });
  }

  async update(
    id: string,
    data: UpdateDeckInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.clientFactory();

    const { data: existing, error: fetchError } = await supabase
      .from('flashcard_decks')
      .select('*, deck_groups(group_id)')
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

    // Share links only exist while the deck is group-visible; the link set follows the
    // RESULTING visibility, so a partial body cannot desynchronise the two (#139). The rules
    // and the "group with zero links" answer live in `planShareLinks`, shared with topics.
    const share = planShareLinks({
      sentVisibility: data.visibility,
      sentGroupIds: data.groupIds,
      storedVisibility: existing.visibility,
    });
    if (share.groupWithoutLinks) return failure('UNPROCESSABLE_ENTITY');
    const requestedGroupIds = share.groupIds;

    // A share change is a teacher decision, on every audience change: an added,
    // removed or replaced group all need the caller to teach the groups involved.
    const storedGroupIds = dbRows(existing.deck_groups).map((row) => row.group_id);
    const audienceToAuthorize = shareAudienceToAuthorize(
      storedGroupIds,
      requestedGroupIds ?? storedGroupIds,
    );
    if (audienceToAuthorize) {
      // The link must belong to the CONTENT's org, not the caller's current UI org.
      // NULL-org content (legacy personal rows) falls back to the active org.
      const contentOrgId = existing.organization_id ?? ctx.activeOrgId ?? null;
      const shareCheck = await groupService.canShareContentToGroups(
        ctx,
        audienceToAuthorize,
        contentOrgId,
      );
      if (isFailure(shareCheck)) return failure(shareCheck.error);
      if (!shareCheck.data) return failure('FORBIDDEN');
    }

    if (data.flashcardIds !== undefined && data.flashcardIds.length > 0) {
      const denied = await this.assertFlashcardsUpdatable(supabase, data.flashcardIds, ctx);
      if (denied) return denied;
    }

    const updateFields = pickDefined({
      name: data.name,
      description: data.description,
      visibility: data.visibility,
    });

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
      // `flashcards.deck_id` is NOT NULL, so cards cannot be detached by writing
      // NULL; only cards explicitly listed below are re-parented into this deck.
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
    const supabase = await this.clientFactory();

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
    const supabase = await this.clientFactory();
    const decks: Database['public']['Tables']['flashcard_decks']['Insert'][] = data.decks.map(
      (d) => ({
        name: d.name,
        description: d.description ?? null,
        created_by: ctx.userId,
        organization_id: ctx.activeOrgId,
        // Bulk create cannot assign groups, so it can only produce personal decks (#139).
        visibility: 'personal',
      }),
    );

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
    const supabase = await this.clientFactory();

    const { data: decks, error: fetchError } = await supabase
      .from('flashcard_decks')
      .select('*')
      .in('id', data.ids);

    if (fetchError) return toDbFailure(fetchError);
    const ownedDecks = dbRows(decks);
    if (ownedDecks.length === 0) return failure('NOT_FOUND');

    for (const deck of ownedDecks) {
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
    const supabase = await this.clientFactory();
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
  private async countOwned(
    supabase: SupabaseClient<Database>,
    ctx: RequestContext,
  ): Promise<number> {
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
