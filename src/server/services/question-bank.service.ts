import type { SupabaseClient } from '@supabase/supabase-js';
import { buildQueryFilter, checkPermission, Permission } from '@/lib/rbac';
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
      const assignments = data.questionIds.map((questionId) => ({
        bank_id: bank.id,
        question_id: questionId,
      }));
      const { error: aError } = await supabase
        .from('question_bank_assignments')
        .insert(assignments);
      if (aError) return toDbFailure(aError);
    }

    return this.getById(bank.id, ctx);
  }

  async list(
    ctx: RequestContext,
    queryParams?: Partial<QuestionBankListQuery>,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const filter = await buildQueryFilter(ctx, Permission.QUESTION_BANK_READ, 'question_bank');
    if (filter._impossible) return success({ items: [], nextCursor: null, hasMore: false });

    if (filter._useRpc) {
      const rpcQuery = supabase.rpc('get_accessible_question_banks', {
        p_user_id: ctx.userId,
        p_org_id: ctx.activeOrgId,
      });
      const sortBy = queryParams?.sortBy ?? 'created_at';
      const sortOrder = queryParams?.sortOrder ?? 'desc';
      const sortAsc = sortOrder === 'asc';
      const pageSize = Math.min(queryParams?.limit ?? 24, 100);
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
      .from('question_banks')
      .select('*, question_count:question_bank_assignments(count)');

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
      const countArr = item.question_count as { count: number }[] | undefined;
      return { ...item, question_count: countArr?.[0]?.count ?? 0 };
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
      items: items as unknown as QuestionBank[],
      nextCursor,
      hasMore,
    } as { items: QuestionBank[]; nextCursor: string | null; hasMore: boolean });
  }

  async getById(id: string, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const filter = await buildQueryFilter(ctx, Permission.QUESTION_BANK_READ, 'question_bank');
    let query = supabase
      .from('question_banks')
      .select('*, question_count:question_bank_assignments(count)')
      .eq('id', id);

    if (filter._impossible) return failure('NOT_FOUND');
    if (filter._useRpc) {
      const { data, error } = await supabase
        .rpc('get_accessible_question_banks', {
          p_user_id: ctx.userId,
          p_org_id: ctx.activeOrgId,
        })
        .eq('id', id)
        .single();
      if (error) return toDbFailure(error);
      return success(data);
    }
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
    await checkPermission(ctx, Permission.QUESTION_BANK_UPDATE, existing);

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
        const { data: assignedQuestionIds } = await supabase
          .from('question_bank_assignments')
          .select('question_id')
          .eq('bank_id', id);

        const questionIds = assignedQuestionIds?.map((a) => a.question_id) ?? [];
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
      await supabase.from('question_bank_assignments').delete().eq('bank_id', id);
      if (data.questionIds.length > 0) {
        const assignments = data.questionIds.map((questionId) => ({
          bank_id: id,
          question_id: questionId,
        }));
        await supabase.from('question_bank_assignments').insert(assignments);
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
    await checkPermission(ctx, Permission.QUESTION_BANK_DELETE, existing);

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
      await checkPermission(ctx, Permission.QUESTION_BANK_DELETE, bank);
    }

    const { error } = await supabase.from('question_banks').delete().in('id', data.ids);
    if (error) return toDbFailure(error);

    return success({ deleted: data.ids.length });
  }
}
