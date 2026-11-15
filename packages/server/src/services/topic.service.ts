import { AccountType, type RequestContext } from '@studiq/authz';
import { dbCount, dbRows } from '@studiq/server/lib/supabase/rows';
import {
  accessibleFilter,
  check,
  Permission,
  resolveGroupResourceIds,
} from '@studiq/server/lib/authz';
import { wrapService } from '@studiq/server/lib/observability';
import type {
  BatchDeleteTopicInput,
  BulkCreateTopicInput,
  CreateTopicInput,
  TopicListQuery,
  UpdateTopicInput,
} from '@studiq/server/models/topic.model';
import {
  applyAccessFilter,
  pageParams,
  pageQuery,
  pickDefined,
  readPage,
} from '@studiq/server/lib/query-list';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';
import { isImpossibleFilter } from '@studiq/server/lib/rbac-filter';
import { failure, isFailure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { createClient } from '@studiq/server/lib/supabase/server';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import { groupService } from '@studiq/server/services/group.service';

export class TopicService {
  constructor(private clientFactory: () => Promise<SupabaseClient<Database>>) {}

  async create(data: CreateTopicInput, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.clientFactory();
    const topicVisibility = ctx.accountType === AccountType.EDUCATOR ? 'group' : 'personal';

    const groupIds = data.visibility === 'group' ? [...new Set(data.groupIds ?? [])] : [];
    if (groupIds.length > 0) {
      const shareCheck = await groupService.canShareContentToGroups(ctx, groupIds, ctx.activeOrgId);
      if (isFailure(shareCheck)) return failure(shareCheck.error);
      if (!shareCheck.data) return failure('FORBIDDEN');
    }

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

    if (groupIds.length > 0) {
      const rows = groupIds.map((gid) => ({
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
    const supabase = await this.clientFactory();

    const filter = await accessibleFilter(ctx, Permission.TOPIC_READ, 'topic');
    if (isImpossibleFilter(filter)) return success({ items: [], nextCursor: null, hasMore: false });

    let query = applyAccessFilter(
      supabase.from('topics').select('*, flashcard_count:flashcard_topic_assignments(count)'),
      filter,
    );

    // Apply owner filter on top of RBAC
    if (queryParams?.owner === 'mine') query = query.eq('created_by', ctx.userId);

    // Explicit group filter (#595): an extra AND after RBAC, so an unknown/foreign group id
    // can only narrow the result — never widen it.
    if (queryParams?.groups?.length) {
      const groupTopicIds = await resolveGroupResourceIds('topic', queryParams.groups);
      if (groupTopicIds.length === 0)
        return success({ items: [], nextCursor: null, hasMore: false });
      query = query.in('id', groupTopicIds);
    }

    // Apply search
    if (queryParams?.q) {
      query = query.or(`name.ilike.%${queryParams.q}%`);
    }

    const paging = pageParams(queryParams, { sortBy: 'created_at', limit: 50 });
    query = pageQuery(query, paging);

    return readPage(query, {
      ...paging,
      map: (item) => ({
        ...item,
        flashcard_count: dbCount(item.flashcard_count),
      }),
    });
  }

  async getById(id: string, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const filter = await accessibleFilter(ctx, Permission.TOPIC_READ, 'topic');
    if (isImpossibleFilter(filter)) return failure('NOT_FOUND');

    const supabase = await this.clientFactory();
    const { data, error } = await applyAccessFilter(
      supabase.from('topics').select('*').eq('id', id),
      filter,
    ).maybeSingle();
    if (error || !data) return failure('NOT_FOUND');
    return success(data);
  }

  async update(
    id: string,
    data: UpdateTopicInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.clientFactory();

    const loaded = await this.loadForWrite(supabase, id, ctx, Permission.TOPIC_UPDATE);
    if (isFailure(loaded)) return loaded;
    const topic = loaded.data;

    const requestedGroupIds = data.groupIds !== undefined ? [...new Set(data.groupIds)] : null;
    // Share links belong to the CONTENT's org, not the caller's current UI org;
    // legacy NULL-org content falls back to the active org.
    if (requestedGroupIds !== null && requestedGroupIds.length > 0) {
      const canShare = await groupService.canShareContentToGroups(
        ctx,
        requestedGroupIds,
        topic.organization_id ?? ctx.activeOrgId ?? null,
      );
      if (isFailure(canShare)) return failure(canShare.error);
      if (!canShare.data) return failure('FORBIDDEN');
    }

    const updateFields = pickDefined({
      name: data.name,
      visibility: data.visibility,
    });

    if (Object.keys(updateFields).length > 0) {
      const { error } = await supabase
        .from('topics')
        .update(updateFields)
        .eq('id', id)
        .select()
        .single();

      if (error) return toDbFailure(error);
    }

    if (requestedGroupIds !== null) {
      const { error: de } = await supabase.from('topic_groups').delete().eq('topic_id', id);
      if (de) return toDbFailure(de);
      if (requestedGroupIds.length > 0) {
        const rows = requestedGroupIds.map((gid) => ({ topic_id: id, group_id: gid }));
        const { error: ae } = await supabase.from('topic_groups').insert(rows);
        if (ae) return toDbFailure(ae);
      }
    }

    return this.getById(id, ctx);
  }

  async delete(id: string, ctx: RequestContext): Promise<ServiceResult<undefined>> {
    const supabase = await this.clientFactory();

    const loaded = await this.loadForWrite(supabase, id, ctx, Permission.TOPIC_DELETE);
    if (isFailure(loaded)) return loaded;

    const { error } = await supabase.from('topics').delete().eq('id', id);

    if (error) return toDbFailure(error);
    return success(undefined);
  }

  /**
   * Loads the topic a single-row write targets and enforces the caller's
   * permission on that row. A missing id is `NOT_FOUND` (never `FORBIDDEN`)
   * so the answer does not confirm that an unreadable topic exists.
   */
  private async loadForWrite(
    supabase: SupabaseClient<Database>,
    id: string,
    ctx: RequestContext,
    permission: string,
  ): Promise<ServiceResult<Database['public']['Tables']['topics']['Row']>> {
    const { data: existing, error } = await supabase
      .from('topics')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error || !existing) return failure('NOT_FOUND');
    await check(ctx, permission, existing);
    return success(existing);
  }

  async bulkCreate(
    data: BulkCreateTopicInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.clientFactory();
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
    const supabase = await this.clientFactory();

    const { data: topics, error: fetchError } = await supabase
      .from('topics')
      .select('*')
      .in('id', data.ids);

    if (fetchError) return toDbFailure(fetchError);
    const rows = dbRows(topics);
    if (rows.length === 0) return failure('NOT_FOUND');

    for (const topic of rows) {
      await check(ctx, Permission.TOPIC_DELETE, topic);
    }

    const { error } = await supabase.from('topics').delete().in('id', data.ids);

    if (error) return toDbFailure(error);

    return success({ deleted: data.ids.length });
  }
}
export const topicService = wrapService(new TopicService(createClient), 'topic.service');
