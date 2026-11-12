import type { RequestContext } from '@studiq/authz';
import { dbRows } from '@studiq/server/lib/supabase/rows';
import { accessibleFilter, check, Permission } from '@studiq/server/lib/authz';
import { wrapService } from '@studiq/server/lib/observability';
import { applyAccessFilter, pageParams, pageQuery, readPage } from '@studiq/server/lib/query-list';
import type { FilterableBuilderWithExtra } from '@studiq/server/lib/postgrest';
import { isImpossibleFilter } from '@studiq/server/lib/rbac-filter';
import { failure, isFailure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { createClient } from '@studiq/server/lib/supabase/server';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type {
  BatchCopyInput,
  BatchDeleteInput,
  BatchMoveInput,
  BatchTopicsInput,
  BulkCreateFlashcardsInput,
  CopyFlashcardInput,
  CreateFlashcardInput,
  FlashcardListQueryInput,
  UpdateFlashcardInput,
} from '@studiq/server/models/flashcard.model';
import { limitsResolver } from '@studiq/server/services/limits.resolver';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';

const FLASHCARD_SELECT = `*, flashcard_topic_assignments(topic_id), deck_id` as const;
const FLASHCARD_SELECT_BY_TOPIC =
  `*, flashcard_topic_assignments!inner(topic_id), deck_id` as const;

/** A flashcard row with the topic assignments `list()` embeds. */
export type FlashcardListRow = Database['public']['Tables']['flashcards']['Row'] & {
  flashcard_topic_assignments: { topic_id: string }[] | null;
};

/** One page of `FlashcardService.list`. */
export interface FlashcardListPage {
  items: FlashcardListRow[];
  nextCursor: string | null;
  hasMore: boolean;
}

export class FlashcardService {
  constructor(private clientFactory: () => Promise<SupabaseClient<Database>>) {}

  async create(data: CreateFlashcardInput, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.clientFactory();

    const flashcardCount = await this.countOwned(supabase, ctx);
    await limitsResolver.checkLimit(ctx, 'max_flashcards', flashcardCount);

    let deckVisibility: Database['public']['Enums']['visibility_type'] | undefined;
    if (data.deckId) {
      const deck = await this.loadTargetDeck(supabase, data.deckId, ctx);
      if (isFailure(deck)) return deck;
      deckVisibility = deck.data.visibility;
    }

    const { data: flashcard, error } = await supabase
      .from('flashcards')
      .insert({
        front: data.front,
        back: data.back,
        created_by: ctx.userId,
        organization_id: ctx.activeOrgId,
        visibility: deckVisibility,
        deck_id: data.deckId,
        question_id: data.questionId ?? null,
      })
      .select()
      .single();

    if (error) return toDbFailure(error);

    if (data.topicIds && data.topicIds.length > 0) {
      const assignments = data.topicIds.map((topicId) => ({
        flashcard_id: flashcard.id,
        topic_id: topicId,
      }));
      await supabase.from('flashcard_topic_assignments').insert(assignments);
    }

    // deck_id is set directly on the flashcard insert above

    return success(flashcard);
  }

  async bulkCreate(
    data: BulkCreateFlashcardsInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.clientFactory();
    const cardCount = data.cards.length;

    const bulkFlashcardCount = await this.countOwned(supabase, ctx);
    await limitsResolver.checkLimit(ctx, 'max_flashcards', bulkFlashcardCount, cardCount);

    let bulkDeckVisibilities: string[] = [];
    if (data.deckId) {
      const { data: decks } = await supabase
        .from('flashcard_decks')
        .select('*')
        .eq('id', data.deckId);
      bulkDeckVisibilities = decks?.map((d) => d.visibility) ?? [];
      const deck = decks?.[0];
      if (!deck) return failure('NOT_FOUND');
      await check(ctx, Permission.DECK_UPDATE, deck);
    }

    const visibility = bulkDeckVisibilities.includes('group') ? 'group' : 'personal';

    const { data: flashcards, error } = await supabase.rpc('bulk_create_flashcards', {
      p_cards: data.cards.map((c) => ({ front: c.front, back: c.back })),
      p_user_id: ctx.userId,
      p_organization_id: ctx.activeOrgId ?? undefined,
      p_visibility: visibility,
      p_deck_ids: data.deckId ? [data.deckId] : [],
      p_topic_ids: data.topicIds ?? [],
    });

    if (error) return toDbFailure(error);

    return success(flashcards);
  }

  async list(
    ctx: RequestContext,
    filters?: Partial<FlashcardListQueryInput>,
  ): Promise<ServiceResult<FlashcardListPage>> {
    const supabase = await this.clientFactory();
    const paging = pageParams(filters, { sortBy: 'created_at', limit: 50 });

    const hasDeckFilter = !!(filters?.deckIds && filters.deckIds.length > 0);
    const hasTopicFilter = !!(filters?.topicIds && filters.topicIds.length > 0);
    const hasSearch = !!filters?.q;

    const filter = await accessibleFilter(ctx, Permission.FLASHCARD_READ, 'flashcard');
    if (isImpossibleFilter(filter)) return success({ items: [], nextCursor: null, hasMore: false });

    // Both projections are literal constants: PostgREST only infers the row type
    // from a literal, and `!inner` is required for the topic filter to narrow rows.
    const applyFilters = <T extends FilterableBuilderWithExtra<T>>(q: T): T => {
      let query = applyAccessFilter(q, filter);

      if (hasTopicFilter) {
        if (filters.topicIds!.length === 1) {
          query = query.filter('flashcard_topic_assignments.topic_id', 'eq', filters.topicIds![0]!);
        } else {
          query = query.filter(
            'flashcard_topic_assignments.topic_id',
            'in',
            `(${filters.topicIds!.join(',')})`,
          );
        }
      }

      if (hasDeckFilter) {
        if (filters.deckIds!.length === 1) {
          query = query.filter('deck_id', 'eq', filters.deckIds![0]!);
        } else {
          query = query.filter('deck_id', 'in', `(${filters.deckIds!.join(',')})`);
        }
      }

      if (hasSearch) {
        const searchTerm = `%${filters.q}%`;
        query = query.or(`front.ilike.${searchTerm},back.ilike.${searchTerm}`);
      }
      return query;
    };

    let query = applyFilters(
      supabase
        .from('flashcards')
        .select(hasTopicFilter ? FLASHCARD_SELECT_BY_TOPIC : FLASHCARD_SELECT),
    );

    query = pageQuery(query, paging);

    return readPage(query, { ...paging, map: (row) => row });
  }

  async listByDeck(deckIds: string[], ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.clientFactory();

    const filter = await accessibleFilter(ctx, Permission.FLASHCARD_READ, 'flashcard');
    if (isImpossibleFilter(filter)) return success([]);

    let query = applyAccessFilter(
      supabase.from('flashcards').select('*, flashcard_topic_assignments(topic_id), deck_id'),
      filter,
    );

    if (deckIds.length > 0) {
      if (deckIds.length === 1) {
        query = query.filter('deck_id', 'eq', deckIds[0]);
      } else {
        query = query.filter('deck_id', 'in', `(${deckIds.join(',')})`);
      }
    }

    const { data, error } = await query;
    if (error) return toDbFailure(error);
    return success(dbRows(data));
  }

  async getById(id: string, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const card = await this.loadVisible(id, ctx);
    return card ? success(card) : failure('NOT_FOUND');
  }

  async update(
    id: string,
    data: UpdateFlashcardInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.clientFactory();

    const denied = await this.assertCardWritable(supabase, id, ctx, Permission.FLASHCARD_UPDATE);
    if (denied) return denied;

    const updateFields: Database['public']['Tables']['flashcards']['Update'] = {};
    if (data.front) updateFields.front = data.front;
    if (data.back) updateFields.back = data.back;

    const { data: flashcard, error } = await supabase
      .from('flashcards')
      .update(updateFields)
      .eq('id', id)
      .select()
      .single();

    if (error && error.code !== 'PGRST116') return toDbFailure(error);
    if (!flashcard) return failure('NOT_FOUND');

    if (data.topicIds !== undefined) {
      await supabase.from('flashcard_topic_assignments').delete().eq('flashcard_id', id);
      if (data.topicIds.length > 0) {
        const assignments = data.topicIds.map((topicId) => ({
          flashcard_id: id,
          topic_id: topicId,
        }));
        await supabase.from('flashcard_topic_assignments').insert(assignments);
      }
    }

    if (data.deckId !== undefined) {
      const { error: dError } = await supabase
        .from('flashcards')
        .update({ deck_id: data.deckId ?? null })
        .eq('id', id);
      if (dError) return toDbFailure(dError);
    }

    const { data: updatedFlashcard } = await supabase
      .from('flashcards')
      .select('*, flashcard_topic_assignments(topic_id), deck_id')
      .eq('id', id)
      .single();

    if (!updatedFlashcard) return failure('NOT_FOUND');
    return success(updatedFlashcard);
  }

  async delete(id: string, ctx: RequestContext): Promise<ServiceResult<void>> {
    const supabase = await this.clientFactory();

    const denied = await this.assertCardWritable(supabase, id, ctx, Permission.FLASHCARD_DELETE);
    if (denied) return denied;

    const { error } = await supabase.from('flashcards').delete().eq('id', id);

    if (error) return toDbFailure(error);

    return success(undefined);
  }

  async copy(
    id: string,
    data: CopyFlashcardInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.clientFactory();

    const { data: original, error: fetchError } = await supabase
      .from('flashcards')
      .select()
      .eq('id', id)
      .maybeSingle();

    if (fetchError || !original) return failure('NOT_FOUND');
    await check(ctx, Permission.FLASHCARD_READ, original);

    const deck = await this.loadTargetDeck(supabase, data.targetDeckId, ctx);
    if (isFailure(deck)) return deck;

    const { data: newFlashcard, error: insertError } = await supabase
      .from('flashcards')
      .insert({
        front: original.front,
        back: original.back,
        created_by: ctx.userId,
        organization_id: ctx.activeOrgId,
        visibility: deck.data.visibility,
        deck_id: data.targetDeckId,
      })
      .select()
      .single();

    if (insertError) return toDbFailure(insertError);

    const { data: topicAssignments, error: topicFetchError } = await supabase
      .from('flashcard_topic_assignments')
      .select('topic_id')
      .eq('flashcard_id', id);

    if (topicFetchError) return toDbFailure(topicFetchError);

    if (dbRows(topicAssignments).length > 0) {
      const newTopicAssignments = dbRows(topicAssignments).map((a) => ({
        flashcard_id: newFlashcard.id,
        topic_id: a.topic_id,
      }));
      await supabase.from('flashcard_topic_assignments').insert(newTopicAssignments);
    }

    const { data: resultFlashcard } = await supabase
      .from('flashcards')
      .select('*, flashcard_topic_assignments(topic_id), deck_id')
      .eq('id', newFlashcard.id)
      .single();

    if (!resultFlashcard) return failure('NOT_FOUND');
    return success(resultFlashcard);
  }

  async batchDelete(data: BatchDeleteInput, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.clientFactory();

    const loaded = await this.loadBatchFor(supabase, data.ids, ctx, Permission.FLASHCARD_DELETE);
    if (isFailure(loaded)) return loaded;

    const { error } = await supabase.from('flashcards').delete().in('id', data.ids);

    if (error) return toDbFailure(error);

    return success({ deleted: data.ids.length });
  }

  async batchTopics(data: BatchTopicsInput, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.clientFactory();

    const op = data.operation;
    const topicIds = data.topicIds ?? [];

    const loaded = await this.loadBatchFor(supabase, data.ids, ctx, Permission.FLASHCARD_UPDATE);
    if (isFailure(loaded)) return loaded;

    if (op === 'add' && topicIds.length > 0) {
      const existing = await supabase
        .from('flashcard_topic_assignments')
        .select('flashcard_id, topic_id')
        .in('flashcard_id', data.ids)
        .in('topic_id', topicIds);

      const existingSet = new Set(
        (existing.data ?? []).map((a) => `${a.flashcard_id}:${a.topic_id}`),
      );

      const toInsert = data.ids.flatMap((fcId) =>
        topicIds
          .filter((tId) => !existingSet.has(`${fcId}:${tId}`))
          .map((tId) => ({ flashcard_id: fcId, topic_id: tId })),
      );

      if (toInsert.length > 0) {
        const { error } = await supabase.from('flashcard_topic_assignments').insert(toInsert);
        if (error) return toDbFailure(error);
      }
    } else if (op === 'remove' && topicIds.length > 0) {
      const { error } = await supabase
        .from('flashcard_topic_assignments')
        .delete()
        .in('flashcard_id', data.ids)
        .in('topic_id', topicIds);

      if (error) return toDbFailure(error);
    } else if (op === 'set') {
      await supabase.from('flashcard_topic_assignments').delete().in('flashcard_id', data.ids);

      if (topicIds.length > 0) {
        const assignments = data.ids.flatMap((flashcardId) =>
          topicIds.map((topicId) => ({ flashcard_id: flashcardId, topic_id: topicId })),
        );
        const { error } = await supabase.from('flashcard_topic_assignments').insert(assignments);
        if (error) return toDbFailure(error);
      }
    }

    return success({ updated: data.ids.length });
  }

  async batchMove(data: BatchMoveInput, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.clientFactory();

    const loaded = await this.loadBatchFor(supabase, data.ids, ctx, Permission.FLASHCARD_UPDATE);
    if (isFailure(loaded)) return loaded;

    const deck = await this.loadTargetDeck(supabase, data.targetDeckId, ctx);
    if (isFailure(deck)) return deck;

    const { error: updateError } = await supabase
      .from('flashcards')
      .update({ deck_id: data.targetDeckId })
      .in('id', data.ids);
    if (updateError) return toDbFailure(updateError);

    return success({ moved: data.ids.length });
  }

  async batchCopy(data: BatchCopyInput, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.clientFactory();

    const loaded = await this.loadBatchFor(supabase, data.ids, ctx, Permission.FLASHCARD_READ);
    if (isFailure(loaded)) return loaded;
    const originalRows = loaded.data;

    const deck = await this.loadTargetDeck(supabase, data.targetDeckId, ctx);
    if (isFailure(deck)) return deck;

    const cardsToInsert = originalRows.map((fc) => ({
      front: fc.front,
      back: fc.back,
      created_by: ctx.userId,
      organization_id: ctx.activeOrgId,
      visibility: deck.data.visibility,
      deck_id: data.targetDeckId,
    }));

    const { data: newFlashcards, error: insertError } = await supabase
      .from('flashcards')
      .insert(cardsToInsert)
      .select();

    if (insertError) return toDbFailure(insertError);
    const inserted = dbRows(newFlashcards);
    if (inserted.length === 0) return failure('NOT_FOUND');

    const { data: topicAssignments } = await supabase
      .from('flashcard_topic_assignments')
      .select('flashcard_id, topic_id')
      .in('flashcard_id', data.ids);

    if (topicAssignments && topicAssignments.length > 0) {
      const oldToNew = new Map(
        originalRows.flatMap((fc, i) => {
          const copy = inserted[i];
          return copy ? [[fc.id, copy.id] as const] : [];
        }),
      );
      const newAssignments = topicAssignments
        .map((a) => ({
          flashcard_id: oldToNew.get(a.flashcard_id),
          topic_id: a.topic_id,
        }))
        .filter((a): a is { flashcard_id: string; topic_id: string } => !!a.flashcard_id);

      if (newAssignments.length > 0) {
        await supabase.from('flashcard_topic_assignments').insert(newAssignments);
      }
    }

    // deck_id is already set on each new flashcard in the insert above

    return success({ copied: data.ids.length, flashcards: inserted });
  }

  /**
   * One readable card in the list projection. The RBAC scope decides
   * visibility, so a card the caller may not read is indistinguishable from a
   * missing one.
   */
  private async loadVisible(id: string, ctx: RequestContext): Promise<FlashcardListRow | null> {
    const supabase = await this.clientFactory();

    const filter = await accessibleFilter(ctx, Permission.FLASHCARD_READ, 'flashcard');
    if (isImpossibleFilter(filter)) return null;

    const { data } = await applyAccessFilter(
      supabase.from('flashcards').select(FLASHCARD_SELECT).eq('id', id),
      filter,
    ).maybeSingle();

    return data;
  }

  /**
   * Guards a single-row write: the card has to exist and the caller has to hold
   * `permission` on it. A missing id answers `NOT_FOUND` (never `FORBIDDEN`),
   * so the response does not confirm that an unreadable card exists.
   */
  private async assertCardWritable(
    supabase: SupabaseClient<Database>,
    id: string,
    ctx: RequestContext,
    permission: string,
  ): Promise<ServiceResult<never> | null> {
    const { data: existing, error } = await supabase
      .from('flashcards')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error || !existing) return failure('NOT_FOUND');
    await check(ctx, permission, existing);
    return null;
  }

  /**
   * Loads every requested card and enforces one permission on each: a batch
   * write either applies to all of them or to none. A batch whose cards are all
   * missing or unreadable is `NOT_FOUND`, not a silent no-op.
   */
  private async loadBatchFor(
    supabase: SupabaseClient<Database>,
    ids: string[],
    ctx: RequestContext,
    permission: string,
  ): Promise<ServiceResult<Database['public']['Tables']['flashcards']['Row'][]>> {
    const { data: flashcards, error } = await supabase.from('flashcards').select('*').in('id', ids);

    if (error) return toDbFailure(error);
    const cards = dbRows(flashcards);
    if (cards.length === 0) return failure('NOT_FOUND');

    for (const card of cards) {
      await check(ctx, permission, card);
    }
    return success(cards);
  }

  /**
   * The deck a card is being moved or copied into. That lands the card in the
   * deck's scope, so it takes `deck.update`, not merely read access.
   */
  private async loadTargetDeck(
    supabase: SupabaseClient<Database>,
    deckId: string,
    ctx: RequestContext,
  ): Promise<ServiceResult<Database['public']['Tables']['flashcard_decks']['Row']>> {
    const { data: deck } = await supabase
      .from('flashcard_decks')
      .select('*')
      .eq('id', deckId)
      .single();

    if (!deck) return failure('NOT_FOUND');
    await check(ctx, Permission.DECK_UPDATE, deck);
    return success(deck);
  }

  /**
   * Count the caller's cards for the limit check (#233): inside an org the count
   * is scoped to content owned by the caller **in that org**, so personal-space
   * cards (and cards from other orgs) never consume the org plan's capacity.
   */
  private async countOwned(
    supabase: SupabaseClient<Database>,
    ctx: RequestContext,
  ): Promise<number> {
    let query = supabase
      .from('flashcards')
      .select('*', { count: 'exact', head: true })
      .eq('created_by', ctx.userId);

    if (ctx.activeOrgId) query = query.eq('organization_id', ctx.activeOrgId);

    const { count } = await query;
    return count ?? 0;
  }
}
export const flashcardService = wrapService(
  new FlashcardService(createClient),
  'flashcard.service',
);
