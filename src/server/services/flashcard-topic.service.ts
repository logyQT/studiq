import { createClient } from '@/lib/supabase/server';
import { AppError } from '@/lib/errors';
import type { CreateTopicInput, UpdateTopicInput } from '@/server/models';
import { mapSupabaseError } from '@/lib/supabase-errors';
import type { RequestContext } from '@/lib/request-context';

export class FlashcardTopicService {
  async create(data: CreateTopicInput, ctx: RequestContext) {
    const supabase = await createClient();

    const { data: topic, error } = await supabase
      .from('flashcard_topics')
      .insert({
        name: data.name,
        university_id: ctx.universityId,
        created_by: ctx.userId,
      })
      .select()
      .single();

    if (error) throw mapSupabaseError(error);
    if (!topic) throw new AppError('NOT_FOUND');
    return topic;
  }

  async list(ctx: RequestContext) {
    const supabase = await createClient();

    let query = supabase
      .from('flashcard_topics')
      .select('*, flashcard_topic_assignments(flashcard_id)')
      .order('created_at', { ascending: false });

    if (ctx.universityId) {
      query = query.or(`created_by.eq.${ctx.userId},university_id.eq.${ctx.universityId}`);
    } else {
      query = query.eq('created_by', ctx.userId);
    }

    const { data, error } = await query;
    if (error) throw mapSupabaseError(error);

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

  async update(id: string, data: UpdateTopicInput, ctx: RequestContext) {
    const supabase = await createClient();

    const { data: topic, error } = await supabase
      .from('flashcard_topics')
      .update({ name: data.name })
      .eq('id', id)
      .eq('created_by', ctx.userId)
      .select()
      .single();

    if (error && error.code !== 'PGRST116') throw mapSupabaseError(error);
    if (!topic) throw new AppError('FORBIDDEN');
    return topic;
  }

  async delete(id: string, ctx: RequestContext) {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('flashcard_topics')
      .delete()
      .eq('id', id)
      .eq('created_by', ctx.userId)
      .select()
      .single();

    if (error && error.code !== 'PGRST116') throw mapSupabaseError(error);
    if (!data) throw new AppError('FORBIDDEN');
  }
}

export const flashcardTopicService = new FlashcardTopicService();
