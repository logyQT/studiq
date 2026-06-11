import { createClient } from '@/lib/supabase/server';
import { AppError } from '@/lib/errors';
import type {
  CreateFlashcardInput,
  BulkCreateFlashcardsInput,
  UpdateFlashcardInput,
  LinkFlashcardInput,
  CopyFlashcardInput,
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

  async list(ctx: RequestContext, filters?: { topicIds?: string[]; deckIds?: string[] }) {
    const supabase = await createClient();

    const filter = await buildQueryFilter(ctx, Permission.FLASHCARD_READ, 'flashcard');
    let query = supabase
      .from('flashcards')
      .select('*, flashcard_topic_assignments(topic_id), flashcard_deck_assignments(deck_id)');

    if (filter._impossible) return [];
    if (filter.or) {
      query = query.or(filter.or);
    } else if (filter.created_by) {
      query = query.eq('created_by', filter.created_by);
    }

    query = query.order('created_at', { ascending: false });

    if (filters?.topicIds && filters.topicIds.length > 0) {
      const { data: assignments } = await supabase
        .from('flashcard_topic_assignments')
        .select('flashcard_id')
        .in('topic_id', filters.topicIds);

      const flashcardIds = [...new Set(assignments?.map((a) => a.flashcard_id) ?? [])];
      if (flashcardIds.length === 0) return [];
      query = query.in('id', flashcardIds);
    }

    if (filters?.deckIds && filters.deckIds.length > 0) {
      const { data: assignments } = await supabase
        .from('flashcard_deck_assignments')
        .select('flashcard_id')
        .in('deck_id', filters.deckIds);

      const flashcardIds = [...new Set(assignments?.map((a) => a.flashcard_id) ?? [])];
      if (flashcardIds.length === 0) return [];
      query = query.in('id', flashcardIds);
    }

    const { data, error } = await query;
    if (error) throw mapSupabaseError(error);
    return data;
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
}

export const flashcardService = new FlashcardService();
