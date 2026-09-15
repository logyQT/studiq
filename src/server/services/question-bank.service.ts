import type { SupabaseClient } from '@supabase/supabase-js';
import { accessibleFilter, check, Permission } from '@/lib/authz';
import { decodeCursor, encodeCursor } from '@/lib/query-list';
import type { RequestContext } from '@/lib/request-context';
import { failure, type ServiceResult, success } from '@/lib/service-result';
import { toDbFailure } from '@/lib/supabase-errors';
import type {
  BatchDeleteQuestionBankInput,
  BulkCreateQuestionBankInput,
  CreateQuestionBankInput,
  QuestionBank,
  QuestionBankListQuery,
  UpdateQuestionBankInput,
} from '@/server/models';

export class QuestionBankService {
  constructor(private createClient: () => Promise<SupabaseClient>) {}

  async create(
    data: CreateQuestionBankInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();
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
    const supabase = await this.createClient();

    const filter = await accessibleFilter(ctx, Permission.QUESTION_BANK_READ, 'question_bank');
    if (filter._impossible) return success({ items: [], nextCursor: null, hasMore: false });

    let query = supabase.from('question_banks').select('*, question_count:questions(count)');

    if (filter.or) query = query.or(filter.or);
    if (filter.created_by) query = query.eq('created_by', filter.created_by);
    if (filter.organization_id) query = query.eq('organization_id', filter.organization_id);

    if (queryParams?.owner && queryParams.owner !== 'all') {
      if (queryParams.owner === 'mine') {
        query = query.eq('created_by', ctx.userId);
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

    const rows = data as Array<Record<string, unknown>> | null;
    const hasMore = (rows?.length ?? 0) > pageSize;
    const sliced = hasMore ? rows!.slice(0, pageSize) : (rows ?? []);
    const items = sliced.map((item) => {
      const countArr = item.question_count as { count: number }[] | undefined;
      return { ...item, question_count: countArr?.[0]?.count ?? 0 };
    });
    const nextCursor = hasMore
      ? encodeCursor(sliced[sliced.length - 1][sortBy], sliced[sliced.length - 1].id)
      : null;

    return success({
      items: items as unknown as QuestionBank[],
      nextCursor,
      hasMore,
    } as { items: QuestionBank[]; nextCursor: string | null; hasMore: boolean });
  }

  async getById(id: string, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const filter = await accessibleFilter(ctx, Permission.QUESTION_BANK_READ, 'question_bank');
    if (filter._impossible) return failure('NOT_FOUND');

    let query = supabase
      .from('question_banks')
      .select('*, question_count:questions(count)')
      .eq('id', id);

    if (filter.or) query = query.or(filter.or);
    if (filter.created_by) query = query.eq('created_by', filter.created_by);
    if (filter.organization_id) query = query.eq('organization_id', filter.organization_id);

    const { data: bank, error } = await query.single();
    if (error || !bank) return failure('NOT_FOUND');

    const countArr = (bank as Record<string, unknown>).question_count as
      | { count: number }[]
      | undefined;
    return success({
      ...bank,
      question_count: countArr?.[0]?.count ?? 0,
    } as unknown as QuestionBank);
  }

  async update(
    id: string,
    data: UpdateQuestionBankInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const { data: existing, error: fetchError } = await supabase
      .from('question_banks')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !existing) return failure('NOT_FOUND');
    await check(ctx, Permission.QUESTION_BANK_UPDATE, existing);

    const updateFields: Record<string, unknown> = {};
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

    if ((data as any).groupIds !== undefined) {
      const { error: de } = await supabase.from('bank_groups').delete().eq('bank_id', id);
      if (de) return toDbFailure(de);
      if ((data as any).groupIds.length > 0) {
        const rows = (data as any).groupIds.map((gid: string) => ({ bank_id: id, group_id: gid }));
        const { error: ae } = await supabase.from('bank_groups').insert(rows);
        if (ae) return toDbFailure(ae);
      }
    }

    if (data.questionIds !== undefined) {
      // First unset bank_id for all questions currently in this bank
      await supabase.from('questions').update({ bank_id: null }).eq('bank_id', id);
      // Then set bank_id for the specified questions
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
    const supabase = await this.createClient();

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
    const supabase = await this.createClient();
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
    const supabase = await this.createClient();

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
}
