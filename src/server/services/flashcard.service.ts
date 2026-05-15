import { createClient } from '@/lib/supabase/server';
import { AppError } from '@/lib/errors';
import type {
  CreateFlashcardInput,
  BulkCreateFlashcardsInput,
  UpdateFlashcardInput,
} from '@/server/models';

export class FlashcardService {
  private async getUserProfile(userId: string) {
    const supabase = await createClient();
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, university_id')
      .eq('id', userId)
      .single();
    return profile;
  }

  async create(data: CreateFlashcardInput, userId: string) {
    const supabase = await createClient();
    const profile = await this.getUserProfile(userId);
    const universityId = profile?.role === 'teacher' ? (profile?.university_id ?? null) : null;

    const { data: flashcard, error } = await supabase
      .from('flashcards')
      .insert({
        front: data.front,
        back: data.back,
        created_by: userId,
        university_id: universityId,
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

    if (data.spaceIds && data.spaceIds.length > 0) {
      const spaceAssignments = data.spaceIds.map((spaceId) => ({
        flashcard_id: flashcard.id,
        space_id: spaceId,
      }));
      await supabase.from('flashcard_space_assignments').insert(spaceAssignments);
    }

    return flashcard;
  }

  async bulkCreate(data: BulkCreateFlashcardsInput, userId: string) {
    const supabase = await createClient();
    const profile = await this.getUserProfile(userId);
    const universityId = profile?.role === 'teacher' ? (profile?.university_id ?? null) : null;

    const cardsToInsert = data.cards.map((c) => ({
      front: c.front,
      back: c.back,
      created_by: userId,
      university_id: universityId,
    }));

    const { data: flashcards, error } = await supabase
      .from('flashcards')
      .insert(cardsToInsert)
      .select();

    if (error) throw new AppError('INTERNAL_SERVER');

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

      if (data.spaceIds && data.spaceIds.length > 0) {
        const spaceAssignments = flashcards.flatMap((fc) =>
          data.spaceIds!.map((spaceId) => ({
            flashcard_id: fc.id,
            space_id: spaceId,
          })),
        );
        await supabase.from('flashcard_space_assignments').insert(spaceAssignments);
      }
    }

    return flashcards;
  }

  async list(userId: string, filters?: { topicIds?: string[]; spaceIds?: string[] }) {
    const supabase = await createClient();
    const profile = await this.getUserProfile(userId);
    const userUniversityId = profile?.university_id;

    let query = supabase
      .from('flashcards')
      .select('*, flashcard_topic_assignments(topic_id), flashcard_space_assignments(space_id)');

    if (userUniversityId) {
      query = query.or(`created_by.eq.${userId},university_id.eq.${userUniversityId}`);
    } else {
      query = query.eq('created_by', userId);
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

    if (filters?.spaceIds && filters.spaceIds.length > 0) {
      const { data: assignments } = await supabase
        .from('flashcard_space_assignments')
        .select('flashcard_id')
        .in('space_id', filters.spaceIds);

      const flashcardIds = [...new Set(assignments?.map((a) => a.flashcard_id) ?? [])];
      if (flashcardIds.length === 0) return [];
      query = query.in('id', flashcardIds);
    }

    const { data, error } = await query;
    if (error) throw new AppError('INTERNAL_SERVER');
    return data;
  }

  async getById(id: string, userId: string) {
    const supabase = await createClient();
    const profile = await this.getUserProfile(userId);
    const userUniversityId = profile?.university_id;

    let query = supabase
      .from('flashcards')
      .select('*, flashcard_topic_assignments(topic_id), flashcard_space_assignments(space_id)')
      .eq('id', id);

    if (userUniversityId) {
      query = query.or(`created_by.eq.${userId},university_id.eq.${userUniversityId}`);
    } else {
      query = query.eq('created_by', userId);
    }

    const { data, error } = await query.single();

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

    if (data.spaceIds !== undefined) {
      await supabase.from('flashcard_space_assignments').delete().eq('flashcard_id', id);
      if (data.spaceIds.length > 0) {
        const assignments = data.spaceIds.map((spaceId) => ({
          flashcard_id: id,
          space_id: spaceId,
        }));
        await supabase.from('flashcard_space_assignments').insert(assignments);
      }
    }

    const { data: updatedFlashcard } = await supabase
      .from('flashcards')
      .select('*, flashcard_topic_assignments(topic_id), flashcard_space_assignments(space_id)')
      .eq('id', id)
      .single();

    if (!updatedFlashcard) throw new AppError('NOT_FOUND');
    return updatedFlashcard;
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
