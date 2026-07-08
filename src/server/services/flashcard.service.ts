import type { SupabaseClient } from '@supabase/supabase-js';
import { buildQueryFilter, checkPermission, Permission } from '@/lib/rbac';
import type { RequestContext } from '@/lib/request-context';
import { failure, type ServiceResult, success } from '@/lib/service-result';
import { toDbFailure } from '@/lib/supabase-errors';
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
} from '@/server/models';
import { planResolver } from '@/server/services';

export class FlashcardService {
  constructor(private createClient: () => Promise<SupabaseClient>) {}

  async create(data: CreateFlashcardInput, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const { count: flashcardCount } = await supabase
      .from('flashcards')
      .select('*', { count: 'exact', head: true })
      .eq('created_by', ctx.userId);
    await planResolver.checkLimit(ctx, 'max_flashcards', flashcardCount ?? 0);

    let deckVisibility: string | undefined;
    if (data.deckId) {
      const { data: deck } = await supabase
        .from('flashcard_decks')
        .select('*')
        .eq('id', data.deckId)
        .single();
      if (!deck) return failure('NOT_FOUND');
      await checkPermission(ctx, Permission.DECK_UPDATE, deck);
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

    if (data.deckId) {
      await supabase.from('flashcard_deck_assignments').insert({
        flashcard_id: flashcard.id,
        deck_id: data.deckId,
      });
    }

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
    await planResolver.checkLimit(ctx, 'max_flashcards', bulkFlashcardCount ?? 0, cardCount);

    let bulkDeckVisibilities: string[] = [];
    if (data.deckIds && data.deckIds.length > 0) {
      const { data: decks } = await supabase
        .from('flashcard_decks')
        .select('*')
        .in('id', data.deckIds);
      bulkDeckVisibilities = decks?.map((d) => d.visibility) ?? [];
      const deckMap = new Map(decks?.map((d) => [d.id, d]) ?? []);
      for (const deckId of data.deckIds) {
        const deck = deckMap.get(deckId);
        if (!deck) return failure('NOT_FOUND');
        await checkPermission(ctx, Permission.DECK_UPDATE, deck);
      }
    }

    const visibility = bulkDeckVisibilities.includes('group') ? 'group' : 'personal';

    const { data: flashcards, error } = await supabase.rpc('bulk_create_flashcards', {
      p_cards: data.cards.map((c) => ({ front: c.front, back: c.back })),
      p_user_id: ctx.userId,
      p_organization_id: ctx.activeOrgId,
      p_visibility: visibility,
      p_deck_ids: data.deckIds ?? [],
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

    const filter = await buildQueryFilter(ctx, Permission.FLASHCARD_READ, 'flashcard');

    if (filter._impossible) return success({ items: [], nextCursor: null, hasMore: false });

    if (filter._useRpc) {
      const rpcParams: Record<string, unknown> = {
        p_user_id: ctx.userId,
        p_org_id: ctx.activeOrgId,
      };
      if (hasDeckFilter) rpcParams.p_deck_ids = filters!.deckIds;
      if (hasTopicFilter) rpcParams.p_topic_ids = filters!.topicIds;
      const rpcQuery = supabase.rpc('get_accessible_flashcards', rpcParams);
      if (hasSearch) {
        const searchTerm = `%${filters!.q}%`;
        void rpcQuery.or(`front.ilike.${searchTerm},back.ilike.${searchTerm}`);
      }
      void rpcQuery.order(sortCol, { ascending: sortAsc }).order('id');
      void rpcQuery.limit(pageSize + 1);
      if (filters?.cursor) {
        const decoded = JSON.parse(Buffer.from(filters.cursor, 'base64').toString('utf-8'));
        const cursorVal = decoded.v;
        const cursorId = decoded.id;
        const op = sortAsc ? 'gt' : 'lt';
        void rpcQuery.or(
          `${sortCol}.${op}.${cursorVal},and(${sortCol}.eq.${cursorVal},id.gt.${cursorId})`,
        );
      }
      const { data, error } = await rpcQuery;
      if (error) return toDbFailure(error);
      const rows = data as unknown as Array<{ id: string; [key: string]: unknown }>;
      const hasMore = (rows?.length ?? 0) > pageSize;
      const items = hasMore ? rows!.slice(0, pageSize) : (rows ?? []);
      const nextCursor = hasMore
        ? Buffer.from(
            JSON.stringify({ v: items[items.length - 1][sortCol], id: items[items.length - 1].id }),
          ).toString('base64')
        : null;
      return success({ items, nextCursor, hasMore });
    }

    let query = supabase
      .from('flashcards')
      .select(
        '*, ' +
          `flashcard_topic_assignments${hasTopicFilter ? '!inner' : ''}(topic_id), ` +
          `flashcard_deck_assignments${hasDeckFilter ? '!inner' : ''}(deck_id)`,
      );

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
        query = query.filter('flashcard_deck_assignments.deck_id', 'eq', filters!.deckIds![0]);
      } else {
        query = query.filter(
          'flashcard_deck_assignments.deck_id',
          'in',
          `(${filters!.deckIds!.join(',')})`,
        );
      }
    }

    if (hasSearch) {
      const searchTerm = `%${filters!.q}%`;
      query = query.or(`front.ilike.${searchTerm},back.ilike.${searchTerm}`);
    }

    query = query.order(sortCol, { ascending: sortAsc }).order('id');

    query = query.limit(pageSize + 1);

    if (filters?.cursor) {
      const decoded = JSON.parse(Buffer.from(filters.cursor, 'base64').toString('utf-8'));
      const cursorVal = decoded.v;
      const cursorId = decoded.id;
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
      ? Buffer.from(
          JSON.stringify({ v: items[items.length - 1][sortCol], id: items[items.length - 1].id }),
        ).toString('base64')
      : null;

    return success({ items, nextCursor, hasMore });
  }

  async listByDeck(deckIds: string[], ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const filter = await buildQueryFilter(ctx, Permission.FLASHCARD_READ, 'flashcard');

    if (filter._impossible) return success([]);
    if (filter._useRpc) {
      const rpcQuery = supabase.rpc('get_accessible_flashcards', {
        p_user_id: ctx.userId,
        p_org_id: ctx.activeOrgId,
      });
      if (deckIds.length > 0) {
        const { data, error } = await rpcQuery.in('id', deckIds);
        if (error) return toDbFailure(error);
        return success((data ?? []) as unknown as FlashcardData[]);
      }
      return success([]);
    }

    let query = supabase
      .from('flashcards')
      .select('*, flashcard_topic_assignments(topic_id), flashcard_deck_assignments(deck_id)');

    if (filter.created_by) query = query.eq('created_by', filter.created_by);
    if (filter.organization_id) query = query.eq('organization_id', filter.organization_id);

    if (deckIds.length > 0) {
      if (deckIds.length === 1) {
        query = query.filter('flashcard_deck_assignments.deck_id', 'eq', deckIds[0]);
      } else {
        query = query.filter('flashcard_deck_assignments.deck_id', 'in', `(${deckIds.join(',')})`);
      }
    }

    const { data, error } = await query;
    if (error) return toDbFailure(error);
    return success((data ?? []) as unknown as FlashcardData[]);
  }

  async getById(id: string, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const filter = await buildQueryFilter(ctx, Permission.FLASHCARD_READ, 'flashcard');

    if (filter._impossible) return failure('NOT_FOUND');
    if (filter._useRpc) {
      const { data, error } = await supabase
        .rpc('get_accessible_flashcards', {
          p_user_id: ctx.userId,
          p_org_id: ctx.activeOrgId,
        })
        .eq('id', id)
        .single();
      if (error) return toDbFailure(error);
      return success(data as unknown as FlashcardData);
    }

    let query = supabase
      .from('flashcards')
      .select('*, flashcard_topic_assignments(topic_id), flashcard_deck_assignments(deck_id)')
      .eq('id', id);

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
    await checkPermission(ctx, Permission.FLASHCARD_UPDATE, existing);

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

    if (data.deckIds !== undefined) {
      await supabase.from('flashcard_deck_assignments').delete().eq('flashcard_id', id);
      if (data.deckIds.length > 0) {
        const assignments = data.deckIds.map((deckId) => ({
          flashcard_id: id,
          deck_id: deckId,
        }));
        await supabase.from('flashcard_deck_assignments').insert(assignments);
      }
    }

    const { data: updatedFlashcard } = await supabase
      .from('flashcards')
      .select('*, flashcard_topic_assignments(topic_id), flashcard_deck_assignments(deck_id)')
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
    await checkPermission(ctx, Permission.FLASHCARD_DELETE, existing);

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
    await checkPermission(ctx, Permission.FLASHCARD_READ, flashcard);

    const assignments = data.deckIds.map((deckId) => ({
      flashcard_id: id,
      deck_id: deckId,
    }));

    for (const deckId of data.deckIds) {
      const { data: deck } = await supabase
        .from('flashcard_decks')
        .select('*')
        .eq('id', deckId)
        .single();
      if (!deck) return failure('NOT_FOUND');
      await checkPermission(ctx, Permission.DECK_UPDATE, deck);
    }

    const { error: insertError } = await supabase
      .from('flashcard_deck_assignments')
      .upsert(assignments, { onConflict: 'flashcard_id,deck_id', ignoreDuplicates: true });

    if (insertError) return toDbFailure(insertError);

    const { data: updatedFlashcard } = await supabase
      .from('flashcards')
      .select('*, flashcard_topic_assignments(topic_id), flashcard_deck_assignments(deck_id)')
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
    await checkPermission(ctx, Permission.FLASHCARD_READ, original);

    const { data: deck, error: deckError } = await supabase
      .from('flashcard_decks')
      .select()
      .eq('id', data.targetDeckId)
      .single();

    if (deckError || !deck) return failure('NOT_FOUND');
    await checkPermission(ctx, Permission.DECK_UPDATE, deck);

    const { data: newFlashcard, error: insertError } = await supabase
      .from('flashcards')
      .insert({
        front: original.front,
        back: original.back,
        created_by: ctx.userId,
        organization_id: ctx.activeOrgId,
        visibility: deck.visibility ?? 'personal',
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

    await supabase.from('flashcard_deck_assignments').insert({
      flashcard_id: newFlashcard.id,
      deck_id: data.targetDeckId,
    });

    const { data: resultFlashcard } = await supabase
      .from('flashcards')
      .select('*, flashcard_topic_assignments(topic_id), flashcard_deck_assignments(deck_id)')
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
      await checkPermission(ctx, Permission.FLASHCARD_DELETE, fc);
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
      await checkPermission(ctx, Permission.FLASHCARD_READ, fc);
    }

    const { data: decks } = await supabase
      .from('flashcard_decks')
      .select('id, created_by, organization_id')
      .in('id', data.deckIds);

    const deckMap = new Map(decks?.map((d) => [d.id, d]) ?? []);
    for (const deckId of data.deckIds) {
      const deck = deckMap.get(deckId);
      if (!deck) return failure('NOT_FOUND');
      await checkPermission(ctx, Permission.DECK_UPDATE, deck);
    }

    const assignments = data.ids.flatMap((flashcardId) =>
      data.deckIds.map((deckId) => ({ flashcard_id: flashcardId, deck_id: deckId })),
    );

    const { error: insertError } = await supabase
      .from('flashcard_deck_assignments')
      .upsert(assignments, { onConflict: 'flashcard_id,deck_id', ignoreDuplicates: true });

    if (insertError) return toDbFailure(insertError);

    return success({ linked: data.ids.length * data.deckIds.length });
  }

  async unlinkFromDeck(
    id: string,
    data: UnlinkFlashcardInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const { data: assignment, error: fetchError } = await supabase
      .from('flashcard_deck_assignments')
      .select('flashcard_id, deck_id')
      .eq('flashcard_id', id)
      .eq('deck_id', data.deckId)
      .single();

    if (fetchError || !assignment) return failure('NOT_FOUND');

    const { data: deck } = await supabase
      .from('flashcard_decks')
      .select('*')
      .eq('id', data.deckId)
      .single();

    if (!deck) return failure('NOT_FOUND');
    await checkPermission(ctx, Permission.DECK_UPDATE, deck);

    const { error } = await supabase
      .from('flashcard_deck_assignments')
      .delete()
      .eq('flashcard_id', id)
      .eq('deck_id', data.deckId);

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
    await checkPermission(ctx, Permission.DECK_UPDATE, deck);

    const { error } = await supabase
      .from('flashcard_deck_assignments')
      .delete()
      .in('flashcard_id', data.ids)
      .eq('deck_id', data.deckId);

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
      await checkPermission(ctx, Permission.FLASHCARD_UPDATE, fc);
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
      await checkPermission(ctx, Permission.FLASHCARD_UPDATE, fc);
    }

    const { data: deck } = await supabase
      .from('flashcard_decks')
      .select('*')
      .eq('id', data.targetDeckId)
      .single();

    if (!deck) return failure('NOT_FOUND');
    await checkPermission(ctx, Permission.DECK_UPDATE, deck);

    const assignments = data.ids.map((flashcardId) => ({
      flashcard_id: flashcardId,
      deck_id: data.targetDeckId,
    }));

    const { error: insertError } = await supabase
      .from('flashcard_deck_assignments')
      .insert(assignments);
    if (insertError) return toDbFailure(insertError);

    await supabase
      .from('flashcard_deck_assignments')
      .delete()
      .in('flashcard_id', data.ids)
      .eq('deck_id', data.sourceDeckId);

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
      await checkPermission(ctx, Permission.FLASHCARD_READ, fc);
    }

    const { data: deck } = await supabase
      .from('flashcard_decks')
      .select('*')
      .eq('id', data.targetDeckId)
      .single();

    if (!deck) return failure('NOT_FOUND');
    await checkPermission(ctx, Permission.DECK_UPDATE, deck);

    const cardsToInsert = originals.map((fc) => ({
      front: fc.front,
      back: fc.back,
      created_by: ctx.userId,
      organization_id: ctx.activeOrgId,
      visibility: deck.visibility ?? 'personal',
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

    const deckAssignments = newFlashcards.map((fc) => ({
      flashcard_id: fc.id,
      deck_id: data.targetDeckId,
    }));

    const { error: daError } = await supabase
      .from('flashcard_deck_assignments')
      .insert(deckAssignments);
    if (daError) return toDbFailure(daError);

    return success({ copied: data.ids.length, flashcards: newFlashcards });
  }
}
