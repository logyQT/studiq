import type { SupabaseClient } from '@supabase/supabase-js';
import { buildQueryFilter, checkPermission, Permission } from '@/lib/rbac';
import type { RequestContext } from '@/lib/request-context';
import { failure, type ServiceResult, success } from '@/lib/service-result';
import { toDbFailure } from '@/lib/supabase-errors';
import type {
  BatchDeleteTopicInput,
  BulkCreateTopicInput,
  CreateTopicInput,
  Topic,
  TopicListQuery,
  UpdateTopicInput,
} from '@/server/models';
import { AccountType } from '@/types';

export class TopicService {
  constructor(private createClient: () => Promise<SupabaseClient>) {}

  async create(data: CreateTopicInput, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();
    const topicVisibility = ctx.accountType === AccountType.EDUCATOR ? 'group' : 'personal';

    const { data: topic, error } = await supabase
      .from('topics')
      .insert({
        name: data.name,
        organization_id: ctx.activeOrgId,
        created_by: ctx.userId,
        visibility: data.visibility ?? topicVisibility,
      })
      .select()
      .single();

    if (error) return toDbFailure(error);
    if (!topic) return failure('NOT_FOUND');

    if ((data as any).visibility === 'group' && (data as any).groupIds?.length) {
      const { groupService } = await import('@/server/services');
      let authorized = false;
      for (const gid of (data as any).groupIds) {
        if (await groupService.isTeacherInGroup(ctx, gid)) {
          authorized = true;
          break;
        }
      }
      if (!authorized) return failure('FORBIDDEN');

      const rows = (data as any).groupIds.map((gid: string) => ({
        topic_id: topic.id,
        group_id: gid,
      }));
      const { error: ae } = await supabase.from('topic_groups').insert(rows);
      if (ae) return toDbFailure(ae);
    }

    return success(topic);
  }

  async list(
    ctx: RequestContext,
    queryParams?: Partial<TopicListQuery>,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const filter = await buildQueryFilter(ctx, Permission.TOPIC_READ, 'topic');
    if (filter._impossible) return success({ items: [], nextCursor: null, hasMore: false });

    if (filter._useRpc) {
      const rpcQuery = supabase.rpc('get_accessible_topics', {
        p_user_id: ctx.userId,
        p_org_id: ctx.activeOrgId,
      });
      const sortBy = queryParams?.sortBy ?? 'created_at';
      const sortOrder = queryParams?.sortOrder ?? 'desc';
      const sortAsc = sortOrder === 'asc';
      const pageSize = Math.min(queryParams?.limit ?? 50, 100);
      if (queryParams?.q) {
        void rpcQuery.ilike('name', `%${queryParams.q}%`);
      }
      void rpcQuery.order(sortBy, { ascending: sortAsc }).order('id');
      void rpcQuery.limit(pageSize + 1);
      if (queryParams?.cursor) {
        const decoded = JSON.parse(Buffer.from(queryParams.cursor, 'base64').toString('utf-8'));
        const cursorVal = decoded.v;
        const cursorId = decoded.id;
        const op = sortAsc ? 'gt' : 'lt';
        void rpcQuery.or(
          `${sortBy}.${op}.${cursorVal},and(${sortBy}.eq.${cursorVal},id.gt.${cursorId})`,
        );
      }
      const { data, error } = await rpcQuery;
      if (error) return toDbFailure(error);
      const rows = data as unknown as Array<{ id: string; [key: string]: unknown }>;
      const hasMore = (rows?.length ?? 0) > pageSize;
      const items = hasMore ? rows!.slice(0, pageSize) : (rows ?? []);
      const nextCursor = hasMore
        ? Buffer.from(
            JSON.stringify({ v: items[items.length - 1][sortBy], id: items[items.length - 1].id }),
          ).toString('base64')
        : null;
      return success({ items, nextCursor, hasMore });
    }

    let query = supabase
      .from('topics')
      .select('*, flashcard_count:flashcard_topic_assignments(count)');

    if (filter.created_by) query = query.eq('created_by', filter.created_by);
    if (filter.organization_id) query = query.eq('organization_id', filter.organization_id);

    // Apply owner filter on top of RBAC
    if (queryParams?.owner && queryParams.owner !== 'all') {
      if (queryParams.owner === 'mine') {
        query = query.eq('created_by', ctx.userId);
      } else if (queryParams.owner === 'shared') {
        query = query.neq('created_by', ctx.userId).eq('visibility', 'group');
      } else if (queryParams.owner === 'group') {
        if (ctx.activeOrgId) {
          query = query
            .neq('created_by', ctx.userId)
            .eq('organization_id', ctx.activeOrgId)
            .eq('visibility', 'group');
        } else {
          return success({ items: [], nextCursor: null, hasMore: false });
        }
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
      query = query.or(
        `${sortBy}.${op}.${cursorVal},and(${sortBy}.eq.${cursorVal},id.gt.${cursorId})`,
      );
    }

    const { data, error } = await query;
    if (error) return toDbFailure(error);

    const rows = data as Array<Record<string, unknown>> | null;
    const hasMore = (rows?.length ?? 0) > pageSize;
    const sliced = hasMore ? rows!.slice(0, pageSize) : (rows ?? []);
    const items = sliced.map((item) => {
      const countArr = item.flashcard_count as { count: number }[] | undefined;
      return { ...item, flashcard_count: countArr?.[0]?.count ?? 0 };
    });
    const nextCursor = hasMore
      ? Buffer.from(
          JSON.stringify({
            v: sliced[sliced.length - 1][sortBy],
            id: sliced[sliced.length - 1].id,
          }),
        ).toString('base64')
      : null;

    return success({
      items: items as unknown as Topic[],
      nextCursor,
      hasMore,
    } as { items: Topic[]; nextCursor: string | null; hasMore: boolean });
  }

  async getById(id: string, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const filter = await buildQueryFilter(ctx, Permission.TOPIC_READ, 'topic');
    if (filter._impossible) return failure('NOT_FOUND');

    if (filter._useRpc) {
      const { data, error } = await supabase
        .rpc('get_accessible_topics', {
          p_user_id: ctx.userId,
          p_org_id: ctx.activeOrgId,
        })
        .eq('id', id)
        .single();
      if (error) return toDbFailure(error);
      return success(data);
    }

    let query = supabase.from('topics').select('*').eq('id', id);
    if (filter.organization_id) {
      query = query.eq('organization_id', filter.organization_id);
    }
    if (filter.created_by) {
      query = query.eq('created_by', filter.created_by);
    }

    const { data, error } = await query.single();
    if (error || !data) return failure('NOT_FOUND');
    return success(data);
  }

  async update(
    id: string,
    data: UpdateTopicInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const { data: existing, error: fetchError } = await supabase
      .from('topics')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !existing) return failure('NOT_FOUND');
    await checkPermission(ctx, Permission.TOPIC_UPDATE, existing);

    const updateFields: Record<string, unknown> = {};
    if (data.name !== undefined) updateFields.name = data.name;
    if (data.visibility !== undefined) updateFields.visibility = data.visibility;

    if (Object.keys(updateFields).length > 0) {
      const { data: topic, error } = await supabase
        .from('topics')
        .update(updateFields)
        .eq('id', id)
        .select()
        .single();

      if (error) return toDbFailure(error);
      if (!topic) return failure('NOT_FOUND');
    }

    if ((data as any).groupIds !== undefined) {
      const { error: de } = await supabase.from('topic_groups').delete().eq('topic_id', id);
      if (de) return toDbFailure(de);
      if ((data as any).groupIds.length > 0) {
        const rows = (data as any).groupIds.map((gid: string) => ({ topic_id: id, group_id: gid }));
        const { error: ae } = await supabase.from('topic_groups').insert(rows);
        if (ae) return toDbFailure(ae);
      }
    }

    return this.getById(id, ctx);
  }

  async delete(id: string, ctx: RequestContext): Promise<ServiceResult<undefined>> {
    const supabase = await this.createClient();

    const { data: existing, error: fetchError } = await supabase
      .from('topics')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !existing) return failure('NOT_FOUND');
    await checkPermission(ctx, Permission.TOPIC_DELETE, existing);

    const { error } = await supabase.from('topics').delete().eq('id', id);

    if (error) return toDbFailure(error);
    return success(undefined);
  }

  async bulkCreate(
    data: BulkCreateTopicInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();
    const topicVisibility = ctx.accountType === AccountType.EDUCATOR ? 'group' : 'personal';

    const topics = data.topics.map((t) => ({
      name: t.name,
      created_by: ctx.userId,
      organization_id: ctx.activeOrgId,
      visibility: t.visibility ?? topicVisibility,
    }));

    const { data: created, error } = await supabase.from('topics').insert(topics).select('*');

    if (error) return toDbFailure(error);
    return success(created);
  }

  async batchDelete(
    data: BatchDeleteTopicInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<{ deleted: number }>> {
    const supabase = await this.createClient();

    const { data: topics, error: fetchError } = await supabase
      .from('topics')
      .select('*')
      .in('id', data.ids);

    if (fetchError) return toDbFailure(fetchError);
    if (!topics || topics.length === 0) return failure('NOT_FOUND');

    for (const topic of topics) {
      await checkPermission(ctx, Permission.TOPIC_DELETE, topic);
    }

    const { error } = await supabase.from('topics').delete().in('id', data.ids);

    if (error) return toDbFailure(error);

    return success({ deleted: data.ids.length });
  }
}
