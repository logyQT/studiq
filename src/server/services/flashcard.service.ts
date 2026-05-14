import { createClient } from '@/lib/supabase/server';
import { AppError } from '@/lib/errors';
import type {
  CreateFlashcardInput,
  BulkCreateFlashcardsInput,
  UpdateFlashcardInput,
} from '@/server/models';

export class FlashcardService {
  async create(data: CreateFlashcardInput, userId: string) {
    const supabase = await createClient();

    const { data: flashcard, error } = await supabase
      .from('flashcards')
      .insert({
        front: data.front,
        back: data.back,
        created_by: userId,
      })
      .select()
      .single();

    if (error || !flashcard) throw new AppError('INTERNAL_SERVER');

    if (data.topicIds && data.topicIds.length > 0) {
      const assignments = data.topicIds.map((topicId) => ({
        flashcard_id: flashcard.id,
        topic_id: topicId,
      }));
      await supabase.from('flashcard_topic_assignments').insert(assignments);
    }

    return this.getById(flashcard.id);
  }

  async bulkCreate(data: BulkCreateFlashcardsInput, userId: string) {
    const supabase = await createClient();

    const cardsToInsert = data.cards.map((c) => ({
      front: c.front,
      back: c.back,
      created_by: userId,
    }));

    const { data: flashcards, error } = await supabase
      .from('flashcards')
      .insert(cardsToInsert)
      .select();

    if (error) throw new AppError('INTERNAL_SERVER');

    if (data.topicIds && data.topicIds.length > 0 && flashcards) {
      const assignments = flashcards.flatMap((fc) =>
        data.topicIds!.map((topicId) => ({
          flashcard_id: fc.id,
          topic_id: topicId,
        })),
      );
      await supabase.from('flashcard_topic_assignments').insert(assignments);
    }

    return flashcards;
  }

  async list(filters?: { topicIds?: string[]; spaceIds?: string[] }) {
    const supabase = await createClient();

    if (filters?.topicIds && filters.topicIds.length > 0) {
      const { data: assignments } = await supabase
        .from('flashcard_topic_assignments')
        .select('flashcard_id')
        .in('topic_id', filters.topicIds);

      const flashcardIds = [...new Set(assignments?.map((a) => a.flashcard_id) ?? [])];
      if (flashcardIds.length === 0) return [];

      const { data, error } = await supabase
        .from('flashcards')
        .select('*, flashcard_topic_assignments(topic_id)')
        .in('id', flashcardIds)
        .order('created_at', { ascending: false });

      if (error) throw new AppError('INTERNAL_SERVER');
      return data;
    }

    if (filters?.spaceIds && filters.spaceIds.length > 0) {
      const { data: assignments } = await supabase
        .from('flashcard_space_assignments')
        .select('flashcard_id')
        .in('space_id', filters.spaceIds);

      const flashcardIds = [...new Set(assignments?.map((a) => a.flashcard_id) ?? [])];
      if (flashcardIds.length === 0) return [];

      const { data, error } = await supabase
        .from('flashcards')
        .select('*, flashcard_topic_assignments(topic_id)')
        .in('id', flashcardIds)
        .order('created_at', { ascending: false });

      if (error) throw new AppError('INTERNAL_SERVER');
      return data;
    }

    const { data, error } = await supabase
      .from('flashcards')
      .select('*, flashcard_topic_assignments(topic_id)')
      .order('created_at', { ascending: false });

    if (error) throw new AppError('INTERNAL_SERVER');
    return data;
  }

  async getById(id: string) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('flashcards')
      .select('*, flashcard_topic_assignments(topic_id)')
      .eq('id', id)
      .single();
    if (error || !data) throw new AppError('NOT_FOUND');
    return data;
  }

  async update(id: string, data: UpdateFlashcardInput, userId: string) {
    const supabase = await createClient();

    const updateFields: Record<string, unknown> = {};
    if (data.front) updateFields.front = data.front;
    if (data.back) updateFields.back = data.back;

    const { data: flashcard, error } = await supabase
      .from('flashcards')
      .update(updateFields)
      .eq('id', id)
      .eq('created_by', userId)
      .select()
      .single();

    if (error && error.code !== 'PGRST116') throw new AppError('INTERNAL_SERVER');
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

    return this.getById(id);
  }

  async delete(id: string, userId: string) {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('flashcards')
      .delete()
      .eq('id', id)
      .eq('created_by', userId)
      .select()
      .single();

    if (error && error.code !== 'PGRST116') throw new AppError('INTERNAL_SERVER');
    if (!data) throw new AppError('FORBIDDEN');
  }
}

export const flashcardService = new FlashcardService();
