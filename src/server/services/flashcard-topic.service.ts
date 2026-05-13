import { createClient } from '@/lib/supabase/server';
import { AppError } from '@/lib/errors';
import type { CreateTopicInput, UpdateTopicInput } from '@/server/models';

export class FlashcardTopicService {
  async create(data: CreateTopicInput, userId: string) {
    const supabase = await createClient();

    const { data: profile } = await supabase
      .from('profiles')
      .select('university_id')
      .eq('id', userId)
      .single();

    const { data: topic, error } = await supabase
      .from('flashcard_topics')
      .insert({
        name: data.name,
        university_id: profile?.university_id ?? null,
        created_by: userId,
      })
      .select()
      .single();

    if (error || !topic) throw new AppError('INTERNAL_SERVER');
    return topic;
  }

  async list(userId: string) {
    const supabase = await createClient();

    const { data: profile } = await supabase
      .from('profiles')
      .select('university_id')
      .eq('id', userId)
      .single();

    let query = supabase
      .from('flashcard_topics')
      .select('*, flashcard_topic_assignments(flashcard_id)')
      .order('created_at', { ascending: false });

    if (profile?.university_id) {
      query = query.eq('university_id', profile.university_id);
    }

    const { data, error } = await query;
    if (error) throw new AppError('INTERNAL_SERVER');

    return (data ?? []).map((topic) => ({
      ...topic,
      flashcard_count: topic.flashcard_topic_assignments?.length ?? 0,
    }));
  }

  async getById(id: string) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('flashcard_topics')
      .select('*')
      .eq('id', id)
      .single();
    if (error || !data) throw new AppError('NOT_FOUND');
    return data;
  }

  async update(id: string, data: UpdateTopicInput, userId: string) {
    const supabase = await createClient();

    const { data: topic, error } = await supabase
      .from('flashcard_topics')
      .update({ name: data.name })
      .eq('id', id)
      .eq('created_by', userId)
      .select()
      .single();

    if (error && error.code !== 'PGRST116') throw new AppError('INTERNAL_SERVER');
    if (!topic) throw new AppError('FORBIDDEN');
    return topic;
  }

  async delete(id: string, userId: string) {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('flashcard_topics')
      .delete()
      .eq('id', id)
      .eq('created_by', userId)
      .select()
      .single();

    if (error && error.code !== 'PGRST116') throw new AppError('INTERNAL_SERVER');
    if (!data) throw new AppError('FORBIDDEN');
  }
}

export const flashcardTopicService = new FlashcardTopicService();
