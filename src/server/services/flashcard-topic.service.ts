import { createClient } from '@/lib/supabase/server';
import { AppError } from '@/lib/errors';
import type { CreateTopicInput, UpdateTopicInput, BatchDeleteTopicInput } from '@/server/models';
import { mapSupabaseError } from '@/lib/supabase-errors';
import type { RequestContext } from '@/lib/request-context';
import { checkPermission, shouldSetUniversityId, buildQueryFilter, Permission } from '@/lib/rbac';

export class FlashcardTopicService {
  async create(data: CreateTopicInput, ctx: RequestContext) {
    const supabase = await createClient();
    const universityId = await shouldSetUniversityId(ctx, Permission.TOPIC_CREATE) ? ctx.universityId : null;

    const { data: topic, error } = await supabase
      .from('flashcard_topics')
      .insert({
        name: data.name,
        university_id: universityId,
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

    const filter = await buildQueryFilter(ctx, Permission.TOPIC_READ, 'topic');
    let query = supabase
      .from('flashcard_topics')
      .select('*, flashcard_topic_assignments(flashcard_id)')
      .order('created_at', { ascending: false });

    if (filter._impossible) return [];
    if (filter.or) {
      query = query.or(filter.or);
    } else if (filter.created_by) {
      query = query.eq('created_by', filter.created_by);
    }

    const { data, error } = await query;
    if (error) throw mapSupabaseError(error);

    return (data ?? []).map((topic) => ({
      ...topic,
      flashcard_count: topic.flashcard_topic_assignments?.length ?? 0,
    }));
  }

  async getById(id: string, ctx: RequestContext) {
    const supabase = await createClient();

    const filter = await buildQueryFilter(ctx, Permission.TOPIC_READ, 'topic');
    let query = supabase
      .from('flashcard_topics')
      .select('*')
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

  async update(id: string, data: UpdateTopicInput, ctx: RequestContext) {
    const supabase = await createClient();

    const { data: existing, error: fetchError } = await supabase
      .from('flashcard_topics')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !existing) throw new AppError('NOT_FOUND');
    await checkPermission(ctx, Permission.TOPIC_UPDATE, existing);

    const { data: topic, error } = await supabase
      .from('flashcard_topics')
      .update({ name: data.name })
      .eq('id', id)
      .select()
      .single();

    if (error) throw mapSupabaseError(error);
    if (!topic) throw new AppError('NOT_FOUND');
    return topic;
  }

  async delete(id: string, ctx: RequestContext) {
    const supabase = await createClient();

    const { data: existing, error: fetchError } = await supabase
      .from('flashcard_topics')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !existing) throw new AppError('NOT_FOUND');
    await checkPermission(ctx, Permission.TOPIC_DELETE, existing);

    const { error } = await supabase
      .from('flashcard_topics')
      .delete()
      .eq('id', id);

    if (error) throw mapSupabaseError(error);
  }

  async batchDelete(data: BatchDeleteTopicInput, ctx: RequestContext) {
    const supabase = await createClient();

    const { data: topics, error: fetchError } = await supabase
      .from('flashcard_topics')
      .select('*')
      .in('id', data.ids);

    if (fetchError) throw mapSupabaseError(fetchError);
    if (!topics || topics.length === 0) throw new AppError('NOT_FOUND');

    for (const topic of topics) {
      await checkPermission(ctx, Permission.TOPIC_DELETE, topic);
    }

    const { error } = await supabase
      .from('flashcard_topics')
      .delete()
      .in('id', data.ids);

    if (error) throw mapSupabaseError(error);

    return { deleted: data.ids.length };
  }
}

export const flashcardTopicService = new FlashcardTopicService();
