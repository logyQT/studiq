import { createClient } from '@/lib/supabase/server';
import { AppError } from '@/lib/errors';
import type {
  CreateFlashcardInput,
  BulkCreateFlashcardsInput,
  UpdateFlashcardInput,
} from '@/server/models';
import { mapSupabaseError } from '@/lib/supabase-errors';
import type { RequestContext } from '@/lib/request-context';
import { UserRole } from '@/types';

export class FlashcardService {
  async create(data: CreateFlashcardInput, ctx: RequestContext) {
    const supabase = await createClient();
    const universityId = ctx.role === UserRole.TEACHER ? ctx.universityId : null;

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

    if (data.deckIds && data.deckIds.length > 0) {
      const deckAssignments = data.deckIds.map((deckId) => ({
        flashcard_id: flashcard.id,
        deck_id: deckId,
      }));
      await supabase.from('flashcard_deck_assignments').insert(deckAssignments);
    }

    return flashcard;
  }

  async bulkCreate(data: BulkCreateFlashcardsInput, ctx: RequestContext) {
    const supabase = await createClient();
    const universityId = ctx.role === UserRole.TEACHER ? ctx.universityId : null;

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

    let query = supabase
      .from('flashcards')
      .select('*, flashcard_topic_assignments(topic_id), flashcard_deck_assignments(deck_id)');

    if (ctx.universityId) {
      query = query.or(`created_by.eq.${ctx.userId},university_id.eq.${ctx.universityId}`);
    } else {
      query = query.eq('created_by', ctx.userId);
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

    let query = supabase
      .from('flashcards')
      .select('*, flashcard_topic_assignments(topic_id), flashcard_deck_assignments(deck_id)')
      .eq('id', id);

    if (ctx.universityId) {
      query = query.or(`created_by.eq.${ctx.userId},university_id.eq.${ctx.universityId}`);
    } else {
      query = query.eq('created_by', ctx.userId);
    }

    const { data, error } = await query.single();

    if (error || !data) throw new AppError('NOT_FOUND');
    return data;
  }

  async update(id: string, data: UpdateFlashcardInput, ctx: RequestContext) {
    const supabase = await createClient();

    const updateFields: Record<string, unknown> = {};
    if (data.front) updateFields.front = data.front;
    if (data.back) updateFields.back = data.back;

    const { data: flashcard, error } = await supabase
      .from('flashcards')
      .update(updateFields)
      .eq('id', id)
      .eq('created_by', ctx.userId)
      .select()
      .single();

    if (error && error.code !== 'PGRST116') throw mapSupabaseError(error);
    if (!flashcard) throw new AppError('FORBIDDEN');

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

    const { data, error } = await supabase
      .from('flashcards')
      .delete()
      .eq('id', id)
      .eq('created_by', ctx.userId)
      .select()
      .single();

    if (error && error.code !== 'PGRST116') throw mapSupabaseError(error);
    if (!data) throw new AppError('FORBIDDEN');
  }
}

export const flashcardService = new FlashcardService();
