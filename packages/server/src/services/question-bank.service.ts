import type { RequestContext } from '@studiq/authz';
import {
  accessibleFilter,
  check,
  Permission,
  resolveGroupResourceIds,
} from '@studiq/server/lib/authz';
import { wrapService } from '@studiq/server/lib/observability';
import { decodeCursor, encodeCursor } from '@studiq/server/lib/query-list';
import { isImpossibleFilter } from '@studiq/server/lib/rbac-filter';
import { failure, isFailure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { createClient } from '@studiq/server/lib/supabase/server';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type {
  BatchDeleteQuestionBankInput,
  BulkCreateQuestionBankInput,
  CreateQuestionBankInput,
  QuestionBankListQuery,
  UpdateQuestionBankInput,
} from '@studiq/server/models/question-bank.model';
import { groupService } from '@studiq/server/services/group.service';
import { limitsResolver } from '@studiq/server/services/limits.resolver';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';

export class QuestionBankService {
  constructor(private clientFactory: () => Promise<SupabaseClient<Database>>) {}

  async create(
    data: CreateQuestionBankInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.clientFactory();

    const groupIds = data.visibility === 'group' ? [...new Set(data.groupIds ?? [])] : [];
    if (groupIds.length > 0) {
      const shareCheck = await groupService.canShareContentToGroups(ctx, groupIds, ctx.activeOrgId);
      if (isFailure(shareCheck)) return failure(shareCheck.error);
      if (!shareCheck.data) return failure('FORBIDDEN');
    }

    const bankCount = await this.countOwned(supabase, ctx);
    await limitsResolver.checkLimit(ctx, 'max_question_banks', bankCount);

    const { data: bank, error } = await supabase
      .from('question_banks')
      .insert({
        name: data.name,
        description: data.description ?? null,
        created_by: ctx.userId,
        organization_id: ctx.activeOrgId,
        visibility: data.visibility ?? 'personal',
      })
      .select()
      .single();

    if (error) return toDbFailure(error);
    if (!bank) return failure('NOT_FOUND');

    if (groupIds.length > 0) {
      const rows = groupIds.map((gid) => ({
        bank_id: bank.id,
        group_id: gid,
      }));
      const { error: ae } = await supabase.from('bank_groups').insert(rows);
      if (ae) return toDbFailure(ae);
    }

    if (data.questionIds && data.questionIds.length > 0) {
      const { error: aError } = await supabase
        .from('questions')
        .update({ bank_id: bank.id })
        .in('id', data.questionIds);
      if (aError) return toDbFailure(aError);
    }

    return this.getById(bank.id, ctx);
  }

  async list(
    ctx: RequestContext,
    queryParams?: Partial<QuestionBankListQuery>,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.clientFactory();

    const filter = await accessibleFilter(ctx, Permission.QUESTION_BANK_READ, 'question_bank');
    if (isImpossibleFilter(filter)) return success({ items: [], nextCursor: null, hasMore: false });

    let query = supabase
      .from('question_banks')
      .select('*, question_count:questions(count), bank_groups(group_id)');

    if (filter.or) query = query.or(filter.or);
    if (filter.created_by) query = query.eq('created_by', filter.created_by);
    if (filter.organization_id) query = query.eq('organization_id', filter.organization_id);

    if (queryParams?.owner === 'mine') {
      query = query.eq('created_by', ctx.userId);
    }

    // Explicit group filter (#595): an extra AND after RBAC, so an unknown/foreign group id
    // can only narrow the result — never widen it.
    if (queryParams?.groups?.length) {
      const groupBankIds = await resolveGroupResourceIds('question_bank', queryParams.groups);
      if (groupBankIds.length === 0)
        return success({ items: [], nextCursor: null, hasMore: false });
      query = query.in('id', groupBankIds);
    }

    if (queryParams?.q) {
      query = query.ilike('name', `%${queryParams.q}%`);
    }

    const sortBy = queryParams?.sortBy ?? 'created_at';
    const sortOrder = queryParams?.sortOrder ?? 'desc';
    const sortAsc = sortOrder === 'asc';
    query = query.order(sortBy, { ascending: sortAsc }).order('id');

    const pageSize = Math.min(queryParams?.limit ?? 24, 100);
    query = query.limit(pageSize + 1);

    if (queryParams?.cursor) {
      const { v: cursorVal, id: cursorId } = decodeCursor(queryParams.cursor);
      const op = sortAsc ? 'gt' : 'lt';
      query = query.or(
        `${sortBy}.${op}.${cursorVal},and(${sortBy}.eq.${cursorVal},id.gt.${cursorId})`,
      );
    }

    const { data, error } = await query;
    if (error) return toDbFailure(error);

    const rows = data ?? [];
    const hasMore = rows.length > pageSize;
    const sliced = hasMore ? rows.slice(0, pageSize) : rows;
    const items = sliced.map((item) => ({
      ...item,
      question_count: item.question_count?.[0]?.count ?? 0,
      groupIds: item.bank_groups?.map((g) => g.group_id) ?? [],
    }));
    const nextCursor = hasMore
      ? encodeCursor(sliced[sliced.length - 1][sortBy], sliced[sliced.length - 1].id)
      : null;

    return success({
      items,
      nextCursor,
      hasMore,
    });
  }

  async getById(id: string, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.clientFactory();

    const filter = await accessibleFilter(ctx, Permission.QUESTION_BANK_READ, 'question_bank');
    if (isImpossibleFilter(filter)) return failure('NOT_FOUND');

    let query = supabase
      .from('question_banks')
      .select('*, question_count:questions(count), bank_groups(group_id)')
      .eq('id', id);

    if (filter.or) query = query.or(filter.or);
    if (filter.created_by) query = query.eq('created_by', filter.created_by);
    if (filter.organization_id) query = query.eq('organization_id', filter.organization_id);

    const { data: bank, error } = await query.single();
    if (error || !bank) return failure('NOT_FOUND');

    return success({
      ...bank,
      question_count: bank.question_count?.[0]?.count ?? 0,
      groupIds: bank.bank_groups?.map((g) => g.group_id) ?? [],
    });
  }

  async update(
    id: string,
    data: UpdateQuestionBankInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.clientFactory();

    const { data: existing, error: fetchError } = await supabase
      .from('question_banks')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !existing) return failure('NOT_FOUND');
    await check(ctx, Permission.QUESTION_BANK_UPDATE, existing);

    const requestedGroupIds = data.groupIds !== undefined ? [...new Set(data.groupIds)] : null;
    if (requestedGroupIds !== null && requestedGroupIds.length > 0) {
      // The link must belong to the CONTENT's org, not the caller's current UI org.
      // NULL-org content (legacy personal rows) falls back to the active org.
      const contentOrgId = existing.organization_id ?? ctx.activeOrgId ?? null;
      const shareCheck = await groupService.canShareContentToGroups(
        ctx,
        requestedGroupIds,
        contentOrgId,
      );
      if (isFailure(shareCheck)) return failure(shareCheck.error);
      if (!shareCheck.data) return failure('FORBIDDEN');
    }

    const updateFields: Database['public']['Tables']['question_banks']['Update'] = {};
    if (data.name !== undefined) updateFields.name = data.name;
    if (data.description !== undefined) updateFields.description = data.description;
    if (data.visibility !== undefined) updateFields.visibility = data.visibility;

    if (Object.keys(updateFields).length > 0) {
      const { data: bank, error } = await supabase
        .from('question_banks')
        .update(updateFields)
        .eq('id', id)
        .select()
        .single();

      if (error) return toDbFailure(error);
      if (!bank) return failure('NOT_FOUND');

      if (data.visibility !== undefined && data.visibility !== existing.visibility) {
        const { data: assignedQuestions } = await supabase
          .from('questions')
          .select('id')
          .eq('bank_id', id);

        const questionIds = assignedQuestions?.map((q) => q.id) ?? [];
        if (questionIds.length > 0) {
          await supabase
            .from('questions')
            .update({ visibility: data.visibility })
            .in('id', questionIds);
        }
      }
    }

    if (requestedGroupIds !== null) {
      const { error: de } = await supabase.from('bank_groups').delete().eq('bank_id', id);
      if (de) return toDbFailure(de);
      if (requestedGroupIds.length > 0) {
        const rows = requestedGroupIds.map((gid) => ({ bank_id: id, group_id: gid }));
        const { error: ae } = await supabase.from('bank_groups').insert(rows);
        if (ae) return toDbFailure(ae);
      }
    }

    if (data.questionIds !== undefined) {
      // `questions.bank_id` is NOT NULL (enforce_fk_not_null migration), so a
      // question cannot be detached from its bank; assigning the listed ones is
      // the whole operation.
      if (data.questionIds.length > 0) {
        const { error: aError } = await supabase
          .from('questions')
          .update({ bank_id: id })
          .in('id', data.questionIds);
        if (aError) return toDbFailure(aError);
      }
    }

    return this.getById(id, ctx);
  }

  async delete(id: string, ctx: RequestContext): Promise<ServiceResult<void>> {
    const supabase = await this.clientFactory();

    const { data: existing, error: fetchError } = await supabase
      .from('question_banks')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !existing) return failure('NOT_FOUND');
    await check(ctx, Permission.QUESTION_BANK_DELETE, existing);

    const { error } = await supabase.from('question_banks').delete().eq('id', id);
    if (error) return toDbFailure(error);

    return success(undefined);
  }

  async bulkCreate(
    data: BulkCreateQuestionBankInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.clientFactory();

    const bankCount = await this.countOwned(supabase, ctx);
    await limitsResolver.checkLimit(ctx, 'max_question_banks', bankCount, data.banks.length);

    const banks = data.banks.map((b) => ({
      name: b.name,
      description: b.description ?? null,
      created_by: ctx.userId,
      organization_id: ctx.activeOrgId,
      visibility: b.visibility ?? 'personal',
    }));

    const { data: created, error } = await supabase
      .from('question_banks')
      .insert(banks)
      .select('*');

    if (error) return toDbFailure(error);
    return success(created);
  }

  async batchDelete(
    data: BatchDeleteQuestionBankInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.clientFactory();

    const { data: banks, error: fetchError } = await supabase
      .from('question_banks')
      .select('*')
      .in('id', data.ids);

    if (fetchError) return toDbFailure(fetchError);
    if (!banks || banks.length === 0) return failure('NOT_FOUND');

    for (const bank of banks) {
      await check(ctx, Permission.QUESTION_BANK_DELETE, bank);
    }

    const { error } = await supabase.from('question_banks').delete().in('id', data.ids);
    if (error) return toDbFailure(error);

    return success({ deleted: data.ids.length });
  }

  /**
   * Count the caller's banks for the limit check (#233): inside an org the count
   * is scoped to content owned by the caller **in that org**, so personal-space
   * banks never consume the org plan's capacity.
   */
  private async countOwned(
    supabase: SupabaseClient<Database>,
    ctx: RequestContext,
  ): Promise<number> {
    let query = supabase
      .from('question_banks')
      .select('*', { count: 'exact', head: true })
      .eq('created_by', ctx.userId);

    if (ctx.activeOrgId) query = query.eq('organization_id', ctx.activeOrgId);

    const { count } = await query;
    return count ?? 0;
  }
}
export const questionBankService = wrapService(
  new QuestionBankService(createClient),
  'question-bank.service',
);
