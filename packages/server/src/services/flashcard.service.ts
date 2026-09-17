import type { RequestContext } from '@studiq/authz';
import { accessibleFilter, check, Permission } from '@studiq/server/lib/authz';
import { wrapService } from '@studiq/server/lib/observability';
import { decodeCursor, encodeCursor } from '@studiq/server/lib/query-list';
import { failure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { createClient } from '@studiq/server/lib/supabase/server';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type {
  BatchCopyInput,
  BatchDeleteInput,
  BatchLinkInput,
  BatchMoveInput,
  BatchTopicsInput,
  BatchUnlinkInput,
  BulkCreateFlashcardsInput,
  CopyFlashcardInput,
  CreateFlashcardInput,
  FlashcardData,
  LinkFlashcardInput,
  UnlinkFlashcardInput,
  UpdateFlashcardInput,
} from '@studiq/server/models/flashcard.model';
import { limitsResolver } from '@studiq/server/services/limits.resolver';
import type { SupabaseClient } from '@supabase/supabase-js';

export class FlashcardService {
  constructor(private createClient: () => Promise<SupabaseClient>) {}

  async create(data: CreateFlashcardInput, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const { count: flashcardCount } = await supabase
      .from('flashcards')
      .select('*', { count: 'exact', head: true })
      .eq('created_by', ctx.userId);
    await limitsResolver.checkLimit(ctx, 'max_flashcards', flashcardCount ?? 0);

    let deckVisibility: string | undefined;
    if (data.deckId) {
      const { data: deck } = await supabase
        .from('flashcard_decks')
        .select('*')
        .eq('id', data.deckId)
        .single();
      if (!deck) return failure('NOT_FOUND');
      await check(ctx, Permission.DECK_UPDATE, deck);
      deckVisibility = deck.visibility;
    }

    const { data: flashcard, error } = await supabase
      .from('flashcards')
      .insert({
        front: data.front,
        back: data.back,
        created_by: ctx.userId,
        organization_id: ctx.activeOrgId,
        visibility: deckVisibility,
        deck_id: data.deckId ?? null,
        question_id: data.questionId ?? null,
      })
      .select()
      .single();

    if (error) return toDbFailure(error);
    if (!flashcard) return failure('NOT_FOUND');

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
    const supabase = await this.createClient();
    const cardCount = data.cards.length;

    const { count: bulkFlashcardCount } = await supabase
      .from('flashcards')
      .select('*', { count: 'exact', head: true })
      .eq('created_by', ctx.userId);
    await limitsResolver.checkLimit(ctx, 'max_flashcards', bulkFlashcardCount ?? 0, cardCount);

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
      p_organization_id: ctx.activeOrgId,
      p_visibility: visibility,
      p_deck_ids: data.deckId ? [data.deckId] : [],
      p_topic_ids: data.topicIds ?? [],
    });

    if (error) return toDbFailure(error);

    return success(flashcards as unknown as FlashcardData[]);
  }

  async list(
    ctx: RequestContext,
    filters?: {
      topicIds?: string[];
      deckIds?: string[];
      q?: string;
      sortBy?: string;
      sortOrder?: string;
      cursor?: string;
      limit?: number;
    },
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();
    const pageSize = Math.min(filters?.limit ?? 50, 100);

    const hasDeckFilter = !!(filters?.deckIds && filters.deckIds.length > 0);
    const hasTopicFilter = !!(filters?.topicIds && filters.topicIds.length > 0);
    const hasSearch = !!filters?.q;

    const sortCol = filters?.sortBy || 'created_at';
    const sortAsc = (filters?.sortOrder || 'desc') === 'asc';

    const filter = await accessibleFilter(ctx, Permission.FLASHCARD_READ, 'flashcard');
    if (filter._impossible) return success({ items: [], nextCursor: null, hasMore: false });

    let query = supabase
      .from('flashcards')
      .select(
        '*, ' +
          `flashcard_topic_assignments${hasTopicFilter ? '!inner' : ''}(topic_id), ` +
          `deck_id`,
      );

    if (filter.or) query = query.or(filter.or);
    if (filter.created_by) query = query.eq('created_by', filter.created_by);
    if (filter.organization_id) query = query.eq('organization_id', filter.organization_id);

    if (hasTopicFilter) {
      if (filters!.topicIds!.length === 1) {
        query = query.filter('flashcard_topic_assignments.topic_id', 'eq', filters!.topicIds![0]);
      } else {
        query = query.filter(
          'flashcard_topic_assignments.topic_id',
          'in',
          `(${filters!.topicIds!.join(',')})`,
        );
      }
    }

    if (hasDeckFilter) {
      if (filters!.deckIds!.length === 1) {
        query = query.filter('deck_id', 'eq', filters!.deckIds![0]);
      } else {
        query = query.filter('deck_id', 'in', `(${filters!.deckIds!.join(',')})`);
      }
    }

    if (hasSearch) {
      const searchTerm = `%${filters!.q}%`;
      query = query.or(`front.ilike.${searchTerm},back.ilike.${searchTerm}`);
    }

    query = query.order(sortCol, { ascending: sortAsc }).order('id');

    query = query.limit(pageSize + 1);

    if (filters?.cursor) {
      const { v: cursorVal, id: cursorId } = decodeCursor(filters.cursor);
      const op = sortAsc ? 'gt' : 'lt';
      query = query.or(
        `${sortCol}.${op}.${cursorVal},and(${sortCol}.eq.${cursorVal},id.gt.${cursorId})`,
      );
    }

    const { data, error } = await query;
    if (error) return toDbFailure(error);

    const rows = data as unknown as Array<{ id: string; [key: string]: unknown }>;
    const hasMore = (rows?.length ?? 0) > pageSize;
    const items = hasMore ? rows!.slice(0, pageSize) : (rows ?? []);
    const nextCursor = hasMore
      ? encodeCursor(items[items.length - 1][sortCol], items[items.length - 1].id)
      : null;

    return success({ items, nextCursor, hasMore });
  }

  async listByDeck(deckIds: string[], ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const filter = await accessibleFilter(ctx, Permission.FLASHCARD_READ, 'flashcard');
    if (filter._impossible) return success([]);

    let query = supabase
      .from('flashcards')
      .select('*, flashcard_topic_assignments(topic_id), deck_id');

    if (filter.or) query = query.or(filter.or);
    if (filter.created_by) query = query.eq('created_by', filter.created_by);
    if (filter.organization_id) query = query.eq('organization_id', filter.organization_id);

    if (deckIds.length > 0) {
      if (deckIds.length === 1) {
        query = query.filter('deck_id', 'eq', deckIds[0]);
      } else {
        query = query.filter('deck_id', 'in', `(${deckIds.join(',')})`);
      }
    }

    const { data, error } = await query;
    if (error) return toDbFailure(error);
    return success((data ?? []) as unknown as FlashcardData[]);
  }

  async getById(id: string, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const filter = await accessibleFilter(ctx, Permission.FLASHCARD_READ, 'flashcard');
    if (filter._impossible) return failure('NOT_FOUND');

    let query = supabase
      .from('flashcards')
      .select('*, flashcard_topic_assignments(topic_id), deck_id')
      .eq('id', id);

    if (filter.or) query = query.or(filter.or);
    if (filter.created_by) query = query.eq('created_by', filter.created_by);
    if (filter.organization_id) query = query.eq('organization_id', filter.organization_id);

    const { data, error } = await query.single();

    if (error || !data) return failure('NOT_FOUND');

    return success(data);
  }

  async update(
    id: string,
    data: UpdateFlashcardInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const { data: existing, error: fetchError } = await supabase
      .from('flashcards')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !existing) return failure('NOT_FOUND');
    await check(ctx, Permission.FLASHCARD_UPDATE, existing);

    const updateFields: Record<string, unknown> = {};
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
    const supabase = await this.createClient();

    const { data: existing, error: fetchError } = await supabase
      .from('flashcards')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !existing) return failure('NOT_FOUND');
    await check(ctx, Permission.FLASHCARD_DELETE, existing);

    const { error } = await supabase.from('flashcards').delete().eq('id', id);

    if (error) return toDbFailure(error);

    return success(undefined);
  }

  async link(
    id: string,
    data: LinkFlashcardInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const { data: flashcard, error: fetchError } = await supabase
      .from('flashcards')
      .select()
      .eq('id', id)
      .single();

    if (fetchError || !flashcard) return failure('NOT_FOUND');
    await check(ctx, Permission.FLASHCARD_READ, flashcard);

    const { data: deck } = await supabase
      .from('flashcard_decks')
      .select('*')
      .eq('id', data.deckId)
      .single();
    if (!deck) return failure('NOT_FOUND');
    await check(ctx, Permission.DECK_UPDATE, deck);

    const { error: updateError } = await supabase
      .from('flashcards')
      .update({ deck_id: data.deckId })
      .eq('id', id);

    if (updateError) return toDbFailure(updateError);

    const { data: updatedFlashcard } = await supabase
      .from('flashcards')
      .select('*, flashcard_topic_assignments(topic_id), deck_id')
      .eq('id', id)
      .single();

    if (!updatedFlashcard) return failure('NOT_FOUND');
    return success(updatedFlashcard);
  }

  async copy(
    id: string,
    data: CopyFlashcardInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const { data: original, error: fetchError } = await supabase
      .from('flashcards')
      .select()
      .eq('id', id)
      .single();

    if (fetchError || !original) return failure('NOT_FOUND');
    await check(ctx, Permission.FLASHCARD_READ, original);

    const { data: deck, error: deckError } = await supabase
      .from('flashcard_decks')
      .select()
      .eq('id', data.targetDeckId)
      .single();

    if (deckError || !deck) return failure('NOT_FOUND');
    await check(ctx, Permission.DECK_UPDATE, deck);

    const { data: newFlashcard, error: insertError } = await supabase
      .from('flashcards')
      .insert({
        front: original.front,
        back: original.back,
        created_by: ctx.userId,
        organization_id: ctx.activeOrgId,
        visibility: deck.visibility ?? 'personal',
        deck_id: data.targetDeckId,
      })
      .select()
      .single();

    if (insertError) return toDbFailure(insertError);
    if (!newFlashcard) return failure('NOT_FOUND');

    const { data: topicAssignments, error: topicFetchError } = await supabase
      .from('flashcard_topic_assignments')
      .select('topic_id')
      .eq('flashcard_id', id);

    if (topicFetchError) return toDbFailure(topicFetchError);

    if (topicAssignments && topicAssignments.length > 0) {
      const newTopicAssignments = topicAssignments.map((a) => ({
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
    const supabase = await this.createClient();

    const { data: flashcards, error: fetchError } = await supabase
      .from('flashcards')
      .select('*')
      .in('id', data.ids);

    if (fetchError) return toDbFailure(fetchError);
    if (!flashcards || flashcards.length === 0) return failure('NOT_FOUND');

    for (const fc of flashcards) {
      await check(ctx, Permission.FLASHCARD_DELETE, fc);
    }

    const { error } = await supabase.from('flashcards').delete().in('id', data.ids);

    if (error) return toDbFailure(error);

    return success({ deleted: data.ids.length });
  }

  async batchLink(data: BatchLinkInput, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const { data: flashcards, error: fetchError } = await supabase
      .from('flashcards')
      .select('id, created_by, organization_id')
      .in('id', data.ids);

    if (fetchError) return toDbFailure(fetchError);
    if (!flashcards || flashcards.length === 0) return failure('NOT_FOUND');

    for (const fc of flashcards) {
      await check(ctx, Permission.FLASHCARD_READ, fc);
    }

    const { data: decks } = await supabase
      .from('flashcard_decks')
      .select('id, created_by, organization_id')
      .eq('id', data.deckId);

    const deckMap = new Map(decks?.map((d) => [d.id, d]) ?? []);
    const deck = deckMap.get(data.deckId);
    if (!deck) return failure('NOT_FOUND');
    await check(ctx, Permission.DECK_UPDATE, deck);

    const { error: updateError } = await supabase
      .from('flashcards')
      .update({ deck_id: data.deckId })
      .in('id', data.ids);

    if (updateError) return toDbFailure(updateError);

    return success({ linked: data.ids.length });
  }

  async unlinkFromDeck(
    id: string,
    data: UnlinkFlashcardInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const { data: flashcard, error: fetchError } = await supabase
      .from('flashcards')
      .select('id, deck_id')
      .eq('id', id)
      .single();

    if (fetchError || !flashcard) return failure('NOT_FOUND');
    if (flashcard.deck_id !== data.deckId) return failure('NOT_FOUND');

    const { data: deck } = await supabase
      .from('flashcard_decks')
      .select('*')
      .eq('id', data.deckId)
      .single();

    if (!deck) return failure('NOT_FOUND');
    await check(ctx, Permission.DECK_UPDATE, deck);

    const { error } = await supabase.from('flashcards').update({ deck_id: null }).eq('id', id);

    if (error) return toDbFailure(error);

    return success({ success: true });
  }

  async batchUnlinkFromDeck(
    data: BatchUnlinkInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const { data: deck } = await supabase
      .from('flashcard_decks')
      .select('*')
      .eq('id', data.deckId)
      .single();

    if (!deck) return failure('NOT_FOUND');
    await check(ctx, Permission.DECK_UPDATE, deck);

    const { error } = await supabase
      .from('flashcards')
      .update({ deck_id: null })
      .in('id', data.ids);

    if (error) return toDbFailure(error);

    return success({ unlinked: data.ids.length });
  }

  async batchTopics(data: BatchTopicsInput, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const { data: flashcards, error: fetchError } = await supabase
      .from('flashcards')
      .select('*')
      .in('id', data.ids);

    if (fetchError) return toDbFailure(fetchError);
    if (!flashcards || flashcards.length === 0) return failure('NOT_FOUND');

    for (const fc of flashcards) {
      await check(ctx, Permission.FLASHCARD_UPDATE, fc);
    }

    const op = data.operation ?? 'set';
    const topicIds = data.topicIds ?? [];

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
    const supabase = await this.createClient();

    const { data: flashcards, error: fetchError } = await supabase
      .from('flashcards')
      .select('*')
      .in('id', data.ids);

    if (fetchError) return toDbFailure(fetchError);
    if (!flashcards || flashcards.length === 0) return failure('NOT_FOUND');

    for (const fc of flashcards) {
      await check(ctx, Permission.FLASHCARD_UPDATE, fc);
    }

    const { data: deck } = await supabase
      .from('flashcard_decks')
      .select('*')
      .eq('id', data.targetDeckId)
      .single();

    if (!deck) return failure('NOT_FOUND');
    await check(ctx, Permission.DECK_UPDATE, deck);

    const { error: updateError } = await supabase
      .from('flashcards')
      .update({ deck_id: data.targetDeckId })
      .in('id', data.ids);
    if (updateError) return toDbFailure(updateError);

    return success({ moved: data.ids.length });
  }

  async batchCopy(data: BatchCopyInput, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const { data: originals, error: fetchError } = await supabase
      .from('flashcards')
      .select('*')
      .in('id', data.ids);

    if (fetchError) return toDbFailure(fetchError);
    if (!originals || originals.length === 0) return failure('NOT_FOUND');

    for (const fc of originals) {
      await check(ctx, Permission.FLASHCARD_READ, fc);
    }

    const { data: deck } = await supabase
      .from('flashcard_decks')
      .select('*')
      .eq('id', data.targetDeckId)
      .single();

    if (!deck) return failure('NOT_FOUND');
    await check(ctx, Permission.DECK_UPDATE, deck);

    const cardsToInsert = originals.map((fc) => ({
      front: fc.front,
      back: fc.back,
      created_by: ctx.userId,
      organization_id: ctx.activeOrgId,
      visibility: deck.visibility ?? 'personal',
      deck_id: data.targetDeckId,
    }));

    const { data: newFlashcards, error: insertError } = await supabase
      .from('flashcards')
      .insert(cardsToInsert)
      .select();

    if (insertError) return toDbFailure(insertError);
    if (!newFlashcards || newFlashcards.length === 0) return failure('NOT_FOUND');

    const { data: topicAssignments } = await supabase
      .from('flashcard_topic_assignments')
      .select('flashcard_id, topic_id')
      .in('flashcard_id', data.ids);

    if (topicAssignments && topicAssignments.length > 0) {
      const oldToNew = new Map(originals.map((fc, i) => [fc.id, newFlashcards[i].id]));
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

    return success({ copied: data.ids.length, flashcards: newFlashcards });
  }
}
export const flashcardService = wrapService(
  new FlashcardService(createClient),
  'flashcard.service',
);
