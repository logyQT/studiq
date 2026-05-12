import { createClient } from '@/lib/supabase/server';
import { AppError, AppErrorCode } from '@/lib/errors';
import type {
  CreateFlashcardInput,
  BulkCreateFlashcardsInput,
  UpdateFlashcardInput,
} from '@/server/models';

export class FlashcardService {
  async create(data: CreateFlashcardInput) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new AppError(AppErrorCode.UNAUTHORIZED, 401);

    const { data: flashcard, error } = await supabase
      .from('flashcards')
      .insert({
        front: data.front,
        back: data.back,
        created_by: user.id,
      })
      .select()
      .single();

    if (error || !flashcard) throw new AppError(AppErrorCode.INTERNAL_SERVER, 500);

    if (data.topicIds && data.topicIds.length > 0) {
      const assignments = data.topicIds.map((topicId) => ({
        flashcard_id: flashcard.id,
        topic_id: topicId,
      }));
      await supabase.from('flashcard_topic_assignments').insert(assignments);
    }

    return this.getById(flashcard.id);
  }

  async bulkCreate(data: BulkCreateFlashcardsInput) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new AppError(AppErrorCode.UNAUTHORIZED, 401);

    const cardsToInsert = data.cards.map((c) => ({
      front: c.front,
      back: c.back,
      created_by: user.id,
    }));

    const { data: flashcards, error } = await supabase
      .from('flashcards')
      .insert(cardsToInsert)
      .select();

    if (error) throw new AppError(AppErrorCode.INTERNAL_SERVER, 500);

    if (data.topicIds && data.topicIds.length > 0 && flashcards) {
      const assignments = flashcards.flatMap((fc) =>
        data.topicIds!.map((topicId) => ({
          flashcard_id: fc.id,
          topic_id: topicId,
        }))
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

      if (error) throw new AppError(AppErrorCode.INTERNAL_SERVER, 500);
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

      if (error) throw new AppError(AppErrorCode.INTERNAL_SERVER, 500);
      return data;
    }

    const { data, error } = await supabase
      .from('flashcards')
      .select('*, flashcard_topic_assignments(topic_id)')
      .order('created_at', { ascending: false });

    if (error) throw new AppError(AppErrorCode.INTERNAL_SERVER, 500);
    return data;
  }

  async getById(id: string) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('flashcards')
      .select('*, flashcard_topic_assignments(topic_id)')
      .eq('id', id)
      .single();
    if (error || !data) throw new AppError(AppErrorCode.NOT_FOUND, 404);
    return data;
  }

  async update(id: string, data: UpdateFlashcardInput) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new AppError(AppErrorCode.UNAUTHORIZED, 401);

    const updateFields: Record<string, unknown> = {};
    if (data.front) updateFields.front = data.front;
    if (data.back) updateFields.back = data.back;

    const { data: flashcard, error } = await supabase
      .from('flashcards')
      .update(updateFields)
      .eq('id', id)
      .eq('created_by', user.id)
      .select()
      .single();

    if (error) throw new AppError(AppErrorCode.INTERNAL_SERVER, 500);
    if (!flashcard) throw new AppError(AppErrorCode.FORBIDDEN, 403);

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

  async delete(id: string) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new AppError(AppErrorCode.UNAUTHORIZED, 401);

    const { error } = await supabase
      .from('flashcards')
      .delete()
      .eq('id', id)
      .eq('created_by', user.id);

    if (error) throw new AppError(AppErrorCode.INTERNAL_SERVER, 500);
  }

  async logPractice(flashcardId: string, wasCorrect: boolean) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new AppError(AppErrorCode.UNAUTHORIZED, 401);

    const { data, error } = await supabase
      .from('flashcard_practice')
      .insert({
        user_id: user.id,
        flashcard_id: flashcardId,
        was_correct: wasCorrect,
      })
      .select()
      .single();

    if (error) throw new AppError(AppErrorCode.INTERNAL_SERVER, 500);
    return data;
  }

  async getPracticeHistory(userId?: string) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new AppError(AppErrorCode.UNAUTHORIZED, 401);

    const targetUserId = userId ?? user.id;
    const { data, error } = await supabase
      .from('flashcard_practice')
      .select('*, flashcards(front, back)')
      .eq('user_id', targetUserId)
      .order('practiced_at', { ascending: false });

    if (error) throw new AppError(AppErrorCode.INTERNAL_SERVER, 500);
    return data;
  }
}

export const flashcardService = new FlashcardService();
