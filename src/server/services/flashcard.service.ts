import { createClient } from '@/lib/supabase/server';
import { AppError } from '@/lib/errors';
import type {
  CreateFlashcardInput,
  BulkCreateFlashcardsInput,
  UpdateFlashcardInput,
  LinkFlashcardInput,
  CopyFlashcardInput,
  BatchDeleteInput,
  BatchLinkInput,
  BatchTopicsInput,
  BatchMoveInput,
  BatchCopyInput,
  UnlinkFlashcardInput,
  BatchUnlinkInput,
} from '@/server/models';
import { mapSupabaseError } from '@/lib/supabase-errors';
import type { RequestContext } from '@/lib/request-context';
import { checkPermission, shouldSetUniversityId, buildQueryFilter, Permission } from '@/lib/rbac';

export class FlashcardService {
  async create(data: CreateFlashcardInput, ctx: RequestContext) {
    const supabase = await createClient();

    if (data.deckId) {
      const { data: deck } = await supabase
        .from('flashcard_decks')
        .select('*')
        .eq('id', data.deckId)
        .single();
      if (!deck) throw new AppError('NOT_FOUND');
      await checkPermission(ctx, Permission.DECK_UPDATE, deck);
    }

    const universityId = await shouldSetUniversityId(ctx, Permission.FLASHCARD_CREATE) ? ctx.universityId : null;

    const { data: flashcard, error } = await supabase
      .from('flashcards')
      .insert({
        front: data.front,
        back: data.back,
        created_by: ctx.userId,
        university_id: universityId,
      })
      .select()
      .single();

    if (error) throw mapSupabaseError(error);
    if (!flashcard) throw new AppError('NOT_FOUND');

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

    return flashcard;
  }

  async bulkCreate(data: BulkCreateFlashcardsInput, ctx: RequestContext) {
    const supabase = await createClient();

    if (data.deckIds && data.deckIds.length > 0) {
      const { data: decks } = await supabase
        .from('flashcard_decks')
        .select('*')
        .in('id', data.deckIds);
      const deckMap = new Map(decks?.map((d) => [d.id, d]) ?? []);
      for (const deckId of data.deckIds) {
        const deck = deckMap.get(deckId);
        if (!deck) throw new AppError('NOT_FOUND');
        await checkPermission(ctx, Permission.DECK_UPDATE, deck);
      }
    }

    const universityId = await shouldSetUniversityId(ctx, Permission.FLASHCARD_CREATE) ? ctx.universityId : null;

    const cardsToInsert = data.cards.map((c) => ({
      front: c.front,
      back: c.back,
      created_by: ctx.userId,
      university_id: universityId,
    }));

    const { data: flashcards, error } = await supabase
      .from('flashcards')
      .insert(cardsToInsert)
      .select();

    if (error) throw mapSupabaseError(error);

    if (flashcards && flashcards.length > 0) {
      if (data.topicIds && data.topicIds.length > 0) {
        const assignments = flashcards.flatMap((fc) =>
          data.topicIds!.map((topicId) => ({
            flashcard_id: fc.id,
            topic_id: topicId,
          })),
        );
        await supabase.from('flashcard_topic_assignments').insert(assignments);
      }

      if (data.deckIds && data.deckIds.length > 0) {
        const deckAssignments = flashcards.flatMap((fc) =>
          data.deckIds!.map((deckId) => ({
            flashcard_id: fc.id,
            deck_id: deckId,
          })),
        );
        await supabase.from('flashcard_deck_assignments').insert(deckAssignments);
      }
    }

    return flashcards;
  }

  async list(ctx: RequestContext, filters?: { topicIds?: string[]; deckIds?: string[]; q?: string; sortBy?: string; sortOrder?: string; cursor?: string; limit?: number }) {
    const supabase = await createClient();
    const pageSize = Math.min(filters?.limit ?? 50, 100);

    const hasDeckFilter = !!(filters?.deckIds && filters.deckIds.length > 0);
    const hasTopicFilter = !!(filters?.topicIds && filters.topicIds.length > 0);
    const hasSearch = !!filters?.q;

    const sortCol = filters?.sortBy || 'created_at';
    const sortAsc = (filters?.sortOrder || 'desc') === 'asc';

    const filter = await buildQueryFilter(ctx, Permission.FLASHCARD_READ, 'flashcard');
    let query = supabase
      .from('flashcards')
      .select(
        '*, ' +
        `flashcard_topic_assignments${hasTopicFilter ? '!inner' : ''}(topic_id), ` +
        `flashcard_deck_assignments${hasDeckFilter ? '!inner' : ''}(deck_id)`,
      );

    if (filter._impossible) return { items: [], nextCursor: null, hasMore: false };
    if (filter.or) {
      query = query.or(filter.or);
    } else if (filter.created_by) {
      query = query.eq('created_by', filter.created_by);
    }

    if (hasTopicFilter) {
      if (filters!.topicIds!.length === 1) {
        query = query.filter('flashcard_topic_assignments.topic_id', 'eq', filters!.topicIds![0]);
      } else {
        query = query.filter('flashcard_topic_assignments.topic_id', 'in', `(${filters!.topicIds!.join(',')})`);
      }
    }

    if (hasDeckFilter) {
      if (filters!.deckIds!.length === 1) {
        query = query.filter('flashcard_deck_assignments.deck_id', 'eq', filters!.deckIds![0]);
      } else {
        query = query.filter('flashcard_deck_assignments.deck_id', 'in', `(${filters!.deckIds!.join(',')})`);
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
      query = query.or(`${sortCol}.${op}.${cursorVal},and(${sortCol}.eq.${cursorVal},id.gt.${cursorId})`);
    }

    const { data, error } = await query;
    if (error) throw mapSupabaseError(error);

    const rows = data as unknown as Array<{ id: string; [key: string]: unknown }>;
    const hasMore = (rows?.length ?? 0) > pageSize;
    const items = hasMore ? rows!.slice(0, pageSize) : (rows ?? []);
    const nextCursor = hasMore
      ? Buffer.from(JSON.stringify({ v: items[items.length - 1][sortCol], id: items[items.length - 1].id })).toString('base64')
      : null;

    return { items, nextCursor, hasMore };
  }

  async getById(id: string, ctx: RequestContext) {
    const supabase = await createClient();

    const filter = await buildQueryFilter(ctx, Permission.FLASHCARD_READ, 'flashcard');
    let query = supabase
      .from('flashcards')
      .select('*, flashcard_topic_assignments(topic_id), flashcard_deck_assignments(deck_id)')
      .eq('id', id);

    if (filter._impossible) throw new AppError('NOT_FOUND');
    if (filter.or) {
      query = query.or(filter.or);
    } else if (filter.created_by) {
      query = query.eq('created_by', filter.created_by);
    }

    const { data, error } = await query.single();

    if (error || !data) throw new AppError('NOT_FOUND');

    return data;
  }

  async update(id: string, data: UpdateFlashcardInput, ctx: RequestContext) {
    const supabase = await createClient();

    const { data: existing, error: fetchError } = await supabase
      .from('flashcards')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !existing) throw new AppError('NOT_FOUND');
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

    if (error && error.code !== 'PGRST116') throw mapSupabaseError(error);
    if (!flashcard) throw new AppError('NOT_FOUND');

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

    if (!updatedFlashcard) throw new AppError('NOT_FOUND');
    return updatedFlashcard;
  }

  async delete(id: string, ctx: RequestContext) {
    const supabase = await createClient();

    const { data: existing, error: fetchError } = await supabase
      .from('flashcards')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !existing) throw new AppError('NOT_FOUND');
    await checkPermission(ctx, Permission.FLASHCARD_DELETE, existing);

    const { error } = await supabase
      .from('flashcards')
      .delete()
      .eq('id', id);

    if (error) throw mapSupabaseError(error);
  }

  async link(id: string, data: LinkFlashcardInput, ctx: RequestContext) {
    const supabase = await createClient();

    const { data: flashcard, error: fetchError } = await supabase
      .from('flashcards')
      .select()
      .eq('id', id)
      .single();

    if (fetchError || !flashcard) throw new AppError('NOT_FOUND');
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
      if (!deck) throw new AppError('NOT_FOUND');
      await checkPermission(ctx, Permission.DECK_UPDATE, deck);
    }

    const { error: insertError } = await supabase
      .from('flashcard_deck_assignments')
      .upsert(assignments, { onConflict: 'flashcard_id,deck_id', ignoreDuplicates: true });

    if (insertError) throw mapSupabaseError(insertError);

    const { data: updatedFlashcard } = await supabase
      .from('flashcards')
      .select('*, flashcard_topic_assignments(topic_id), flashcard_deck_assignments(deck_id)')
      .eq('id', id)
      .single();

    if (!updatedFlashcard) throw new AppError('NOT_FOUND');
    return updatedFlashcard;
  }

  async copy(id: string, data: CopyFlashcardInput, ctx: RequestContext) {
    const supabase = await createClient();

    const { data: original, error: fetchError } = await supabase
      .from('flashcards')
      .select()
      .eq('id', id)
      .single();

    if (fetchError || !original) throw new AppError('NOT_FOUND');
    await checkPermission(ctx, Permission.FLASHCARD_READ, original);

    const { data: deck, error: deckError } = await supabase
      .from('flashcard_decks')
      .select()
      .eq('id', data.targetDeckId)
      .single();

    if (deckError || !deck) throw new AppError('NOT_FOUND');
    await checkPermission(ctx, Permission.DECK_UPDATE, deck);

    const universityId = await shouldSetUniversityId(ctx, Permission.FLASHCARD_CREATE) ? ctx.universityId : null;

    const { data: newFlashcard, error: insertError } = await supabase
      .from('flashcards')
      .insert({
        front: original.front,
        back: original.back,
        created_by: ctx.userId,
        university_id: universityId,
      })
      .select()
      .single();

    if (insertError) throw mapSupabaseError(insertError);
    if (!newFlashcard) throw new AppError('NOT_FOUND');

    const { data: topicAssignments, error: topicFetchError } = await supabase
      .from('flashcard_topic_assignments')
      .select('topic_id')
      .eq('flashcard_id', id);

    if (topicFetchError) throw mapSupabaseError(topicFetchError);

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

    if (!resultFlashcard) throw new AppError('NOT_FOUND');
    return resultFlashcard;
  }

  async batchDelete(data: BatchDeleteInput, ctx: RequestContext) {
    const supabase = await createClient();

    const { data: flashcards, error: fetchError } = await supabase
      .from('flashcards')
      .select('*')
      .in('id', data.ids);

    if (fetchError) throw mapSupabaseError(fetchError);
    if (!flashcards || flashcards.length === 0) throw new AppError('NOT_FOUND');

    for (const fc of flashcards) {
      await checkPermission(ctx, Permission.FLASHCARD_DELETE, fc);
    }

    const { error } = await supabase
      .from('flashcards')
      .delete()
      .in('id', data.ids);

    if (error) throw mapSupabaseError(error);

    return { deleted: data.ids.length };
  }

  async batchLink(data: BatchLinkInput, ctx: RequestContext) {
    const supabase = await createClient();

    const { data: flashcards, error: fetchError } = await supabase
      .from('flashcards')
      .select('id, created_by, university_id')
      .in('id', data.ids);

    if (fetchError) throw mapSupabaseError(fetchError);
    if (!flashcards || flashcards.length === 0) throw new AppError('NOT_FOUND');

    for (const fc of flashcards) {
      await checkPermission(ctx, Permission.FLASHCARD_READ, fc);
    }

    const { data: decks } = await supabase
      .from('flashcard_decks')
      .select('id, created_by, university_id')
      .in('id', data.deckIds);

    const deckMap = new Map(decks?.map((d) => [d.id, d]) ?? []);
    for (const deckId of data.deckIds) {
      const deck = deckMap.get(deckId);
      if (!deck) throw new AppError('NOT_FOUND');
      await checkPermission(ctx, Permission.DECK_UPDATE, deck);
    }

    const assignments = data.ids.flatMap((flashcardId) =>
      data.deckIds.map((deckId) => ({ flashcard_id: flashcardId, deck_id: deckId })),
    );

    const { error: insertError } = await supabase
      .from('flashcard_deck_assignments')
      .upsert(assignments, { onConflict: 'flashcard_id,deck_id', ignoreDuplicates: true });

    if (insertError) throw mapSupabaseError(insertError);

    return { linked: data.ids.length * data.deckIds.length };
  }

  async unlinkFromDeck(id: string, data: UnlinkFlashcardInput, ctx: RequestContext) {
    const supabase = await createClient();

    const { data: assignment, error: fetchError } = await supabase
      .from('flashcard_deck_assignments')
      .select('flashcard_id, deck_id')
      .eq('flashcard_id', id)
      .eq('deck_id', data.deckId)
      .single();

    if (fetchError || !assignment) throw new AppError('NOT_FOUND');

    const { data: deck } = await supabase
      .from('flashcard_decks')
      .select('*')
      .eq('id', data.deckId)
      .single();

    if (!deck) throw new AppError('NOT_FOUND');
    await checkPermission(ctx, Permission.DECK_UPDATE, deck);

    const { error } = await supabase
      .from('flashcard_deck_assignments')
      .delete()
      .eq('flashcard_id', id)
      .eq('deck_id', data.deckId);

    if (error) throw mapSupabaseError(error);

    return { success: true };
  }

  async batchUnlinkFromDeck(data: BatchUnlinkInput, ctx: RequestContext) {
    const supabase = await createClient();

    const { data: deck } = await supabase
      .from('flashcard_decks')
      .select('*')
      .eq('id', data.deckId)
      .single();

    if (!deck) throw new AppError('NOT_FOUND');
    await checkPermission(ctx, Permission.DECK_UPDATE, deck);

    const { error } = await supabase
      .from('flashcard_deck_assignments')
      .delete()
      .in('flashcard_id', data.ids)
      .eq('deck_id', data.deckId);

    if (error) throw mapSupabaseError(error);

    return { unlinked: data.ids.length };
  }

  async batchTopics(data: BatchTopicsInput, ctx: RequestContext) {
    const supabase = await createClient();

    const { data: flashcards, error: fetchError } = await supabase
      .from('flashcards')
      .select('*')
      .in('id', data.ids);

    if (fetchError) throw mapSupabaseError(fetchError);
    if (!flashcards || flashcards.length === 0) throw new AppError('NOT_FOUND');

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
        if (error) throw mapSupabaseError(error);
      }
    } else if (op === 'remove' && topicIds.length > 0) {
      const { error } = await supabase
        .from('flashcard_topic_assignments')
        .delete()
        .in('flashcard_id', data.ids)
        .in('topic_id', topicIds);

      if (error) throw mapSupabaseError(error);
    } else if (op === 'set') {
      await supabase.from('flashcard_topic_assignments').delete().in('flashcard_id', data.ids);

      if (topicIds.length > 0) {
        const assignments = data.ids.flatMap((flashcardId) =>
          topicIds.map((topicId) => ({ flashcard_id: flashcardId, topic_id: topicId })),
        );
        const { error } = await supabase.from('flashcard_topic_assignments').insert(assignments);
        if (error) throw mapSupabaseError(error);
      }
    }

    return { updated: data.ids.length };
  }

  async batchMove(data: BatchMoveInput, ctx: RequestContext) {
    const supabase = await createClient();

    const { data: flashcards, error: fetchError } = await supabase
      .from('flashcards')
      .select('*')
      .in('id', data.ids);

    if (fetchError) throw mapSupabaseError(fetchError);
    if (!flashcards || flashcards.length === 0) throw new AppError('NOT_FOUND');

    for (const fc of flashcards) {
      await checkPermission(ctx, Permission.FLASHCARD_UPDATE, fc);
    }

    const { data: deck } = await supabase
      .from('flashcard_decks')
      .select('*')
      .eq('id', data.targetDeckId)
      .single();

    if (!deck) throw new AppError('NOT_FOUND');
    await checkPermission(ctx, Permission.DECK_UPDATE, deck);

    const assignments = data.ids.map((flashcardId) => ({
      flashcard_id: flashcardId,
      deck_id: data.targetDeckId,
    }));

    const { error: insertError } = await supabase.from('flashcard_deck_assignments').insert(assignments);
    if (insertError) throw mapSupabaseError(insertError);

    await supabase.from('flashcard_deck_assignments').delete().in('flashcard_id', data.ids).eq('deck_id', data.sourceDeckId);

    return { moved: data.ids.length };
  }

  async batchCopy(data: BatchCopyInput, ctx: RequestContext) {
    const supabase = await createClient();

    const { data: originals, error: fetchError } = await supabase
      .from('flashcards')
      .select('*')
      .in('id', data.ids);

    if (fetchError) throw mapSupabaseError(fetchError);
    if (!originals || originals.length === 0) throw new AppError('NOT_FOUND');

    for (const fc of originals) {
      await checkPermission(ctx, Permission.FLASHCARD_READ, fc);
    }

    const { data: deck } = await supabase
      .from('flashcard_decks')
      .select('*')
      .eq('id', data.targetDeckId)
      .single();

    if (!deck) throw new AppError('NOT_FOUND');
    await checkPermission(ctx, Permission.DECK_UPDATE, deck);

    const universityId = await shouldSetUniversityId(ctx, Permission.FLASHCARD_CREATE) ? ctx.universityId : null;

    const cardsToInsert = originals.map((fc) => ({
      front: fc.front,
      back: fc.back,
      created_by: ctx.userId,
      university_id: universityId,
    }));

    const { data: newFlashcards, error: insertError } = await supabase
      .from('flashcards')
      .insert(cardsToInsert)
      .select();

    if (insertError) throw mapSupabaseError(insertError);
    if (!newFlashcards || newFlashcards.length === 0) throw new AppError('NOT_FOUND');

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

    const { error: daError } = await supabase.from('flashcard_deck_assignments').insert(deckAssignments);
    if (daError) throw mapSupabaseError(daError);

    return { copied: data.ids.length, flashcards: newFlashcards };
  }
}

export const flashcardService = new FlashcardService();
