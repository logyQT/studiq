import { createClient } from '@/lib/supabase/server';
import { AppError } from '@/lib/errors';
import type { CreateTopicInput, UpdateTopicInput, BatchDeleteTopicInput, BulkCreateTopicInput, TopicListQuery } from '@/server/models';
import { mapSupabaseError } from '@/lib/supabase-errors';
import type { RequestContext } from '@/lib/request-context';
import { checkPermission, shouldSetUniversityId, buildQueryFilter, Permission } from '@/lib/rbac';
import type { Topic } from '@/types/flashcards';

export class FlashcardTopicService {
  async create(data: CreateTopicInput, ctx: RequestContext) {
    const supabase = await createClient();
    const organizationId = await shouldSetUniversityId(ctx, Permission.TOPIC_CREATE) ? ctx.activeOrgId : null;

    const { data: topic, error } = await supabase
      .from('flashcard_topics')
      .insert({
        name: data.name,
        organization_id: organizationId,
        created_by: ctx.userId,
      })
      .select()
      .single();

    if (error) throw mapSupabaseError(error);
    if (!topic) throw new AppError('NOT_FOUND');
    return topic;
  }

  async list(ctx: RequestContext, queryParams?: Partial<TopicListQuery>) {
    const supabase = await createClient();

    const filter = await buildQueryFilter(ctx, Permission.TOPIC_READ, 'topic');
    if (filter._impossible) return { items: [], nextCursor: null, hasMore: false };

    let query = supabase
      .from('flashcard_topics')
      .select('*, flashcard_count:flashcard_topic_assignments(count)');

    if (filter.or) {
      query = query.or(filter.or);
    } else if (filter.created_by) {
      query = query.eq('created_by', filter.created_by);
    }

    // Apply owner filter on top of RBAC
    if (queryParams?.owner && queryParams.owner !== 'all') {
      if (queryParams.owner === 'mine') {
        query = query.eq('created_by', ctx.userId);
      } else if (queryParams.owner === 'shared') {
        query = query.neq('created_by', ctx.userId);
      }
    }

    // Apply search
    if (queryParams?.q) {
      query = query.or(`name.ilike.%${queryParams.q}%`);
    }

    // Apply sorting with tie-breaker
    const sortBy = queryParams?.sortBy ?? 'created_at';
    const sortOrder = queryParams?.sortOrder ?? 'desc';
    const sortAsc = sortOrder === 'asc';
    query = query.order(sortBy, { ascending: sortAsc }).order('id');

    // Cursor-based pagination
    const pageSize = Math.min(queryParams?.limit ?? 50, 100);
    query = query.limit(pageSize + 1);

    if (queryParams?.cursor) {
      const decoded = JSON.parse(Buffer.from(queryParams.cursor, 'base64').toString('utf-8'));
      const cursorVal = decoded.v;
      const cursorId = decoded.id;
      const op = sortAsc ? 'gt' : 'lt';
      query = query.or(`${sortBy}.${op}.${cursorVal},and(${sortBy}.eq.${cursorVal},id.gt.${cursorId})`);
    }

    const { data, error } = await query;
    if (error) throw mapSupabaseError(error);

    const rows = data as Array<Record<string, unknown>> | null;
    const hasMore = (rows?.length ?? 0) > pageSize;
    const sliced = hasMore ? rows!.slice(0, pageSize) : (rows ?? []);
    const items = sliced.map((item) => {
      const countArr = item.flashcard_count as { count: number }[] | undefined;
      return { ...item, flashcard_count: countArr?.[0]?.count ?? 0 };
    });
    const nextCursor = hasMore
      ? Buffer.from(JSON.stringify({ v: sliced[sliced.length - 1][sortBy], id: sliced[sliced.length - 1].id })).toString('base64')
      : null;

    return {
      items: items as unknown as Topic[],
      nextCursor,
      hasMore,
    } as { items: Topic[]; nextCursor: string | null; hasMore: boolean };
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

  async bulkCreate(data: BulkCreateTopicInput, ctx: RequestContext) {
    const supabase = await createClient();
    const organizationId = await shouldSetUniversityId(ctx, Permission.TOPIC_CREATE) ? ctx.activeOrgId : null;

    const topics = data.topics.map((t) => ({
      name: t.name,
      created_by: ctx.userId,
      organization_id: organizationId,
    }));

    const { data: created, error } = await supabase
      .from('flashcard_topics')
      .insert(topics)
      .select('*');

    if (error) throw mapSupabaseError(error);
    return created;
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
