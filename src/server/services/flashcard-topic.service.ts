import { createClient } from '@/lib/supabase/server';
import { AppError, AppErrorCode } from '@/lib/errors';
import type { CreateTopicInput, UpdateTopicInput } from '@/server/models';

export class FlashcardTopicService {
  async create(data: CreateTopicInput) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new AppError(AppErrorCode.UNAUTHORIZED, 401);

    const { data: profile } = await supabase
      .from('profiles')
      .select('university_id')
      .eq('id', user.id)
      .single();

    const { data: topic, error } = await supabase
      .from('flashcard_topics')
      .insert({
        name: data.name,
        university_id: profile?.university_id ?? null,
        created_by: user.id,
      })
      .select()
      .single();

    if (error || !topic) throw new AppError(AppErrorCode.INTERNAL_SERVER, 500);
    return topic;
  }

  async list() {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new AppError(AppErrorCode.UNAUTHORIZED, 401);

    const { data: profile } = await supabase
      .from('profiles')
      .select('university_id')
      .eq('id', user.id)
      .single();

    let query = supabase
      .from('flashcard_topics')
      .select('*, flashcard_topic_assignments(flashcard_id)')
      .order('created_at', { ascending: false });

    if (profile?.university_id) {
      query = query.eq('university_id', profile.university_id);
    }

    const { data, error } = await query;
    if (error) throw new AppError(AppErrorCode.INTERNAL_SERVER, 500);

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
    if (error || !data) throw new AppError(AppErrorCode.NOT_FOUND, 404);
    return data;
  }

  async update(id: string, data: UpdateTopicInput) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new AppError(AppErrorCode.UNAUTHORIZED, 401);

    const { data: topic, error } = await supabase
      .from('flashcard_topics')
      .update({ name: data.name })
      .eq('id', id)
      .eq('created_by', user.id)
      .select()
      .single();

    if (error) throw new AppError(AppErrorCode.INTERNAL_SERVER, 500);
    if (!topic) throw new AppError(AppErrorCode.FORBIDDEN, 403);
    return topic;
  }

  async delete(id: string) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new AppError(AppErrorCode.UNAUTHORIZED, 401);

    const { error } = await supabase
      .from('flashcard_topics')
      .delete()
      .eq('id', id)
      .eq('created_by', user.id);

    if (error) throw new AppError(AppErrorCode.INTERNAL_SERVER, 500);
  }
}

export const flashcardTopicService = new FlashcardTopicService();
