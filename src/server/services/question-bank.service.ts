import { AppError } from '@/lib/errors';
import { buildQueryFilter, checkPermission, Permission, shouldSetUniversityId } from '@/lib/rbac';
import type { RequestContext } from '@/lib/request-context';
import { createClient } from '@/lib/supabase/server';
import { mapSupabaseError } from '@/lib/supabase-errors';
import type {
  BatchDeleteQuestionBankInput,
  BulkCreateQuestionBankInput,
  CreateQuestionBankInput,
  QuestionBankListQuery,
  UpdateQuestionBankInput,
} from '@/server/models';
import type { QuestionBank } from '@/types/questions';

export class QuestionBankService {
  async create(data: CreateQuestionBankInput, ctx: RequestContext) {
    const supabase = await createClient();
    const organizationId = (await shouldSetUniversityId(ctx, Permission.QUESTION_BANK_CREATE))
      ? ctx.activeOrgId
      : null;

    const { data: bank, error } = await supabase
      .from('question_banks')
      .insert({
        name: data.name,
        description: data.description ?? null,
        created_by: ctx.userId,
        organization_id: organizationId,
      })
      .select()
      .single();

    if (error) throw mapSupabaseError(error);
    if (!bank) throw new AppError('NOT_FOUND');

    if (data.questionIds && data.questionIds.length > 0) {
      const assignments = data.questionIds.map((questionId) => ({
        bank_id: bank.id,
        question_id: questionId,
      }));
      const { error: aError } = await supabase
        .from('question_bank_assignments')
        .insert(assignments);
      if (aError) throw mapSupabaseError(aError);
    }

    return this.getById(bank.id, ctx);
  }

  async list(ctx: RequestContext, queryParams?: Partial<QuestionBankListQuery>) {
    const supabase = await createClient();

    const filter = await buildQueryFilter(ctx, Permission.QUESTION_BANK_READ, 'question_bank');
    if (filter._impossible) return { items: [], nextCursor: null, hasMore: false };

    let query = supabase
      .from('question_banks')
      .select('*, question_count:question_bank_assignments(count)');

    if (filter.or) {
      query = query.or(filter.or);
    } else if (filter.created_by) {
      query = query.eq('created_by', filter.created_by);
    }

    if (queryParams?.owner === 'mine') {
      query = query.eq('created_by', ctx.userId);
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
    if (error) throw mapSupabaseError(error);

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

    return {
      items: items as unknown as QuestionBank[],
      nextCursor,
      hasMore,
    } as { items: QuestionBank[]; nextCursor: string | null; hasMore: boolean };
  }

  async getById(id: string, ctx: RequestContext) {
    const supabase = await createClient();

    const filter = await buildQueryFilter(ctx, Permission.QUESTION_BANK_READ, 'question_bank');
    let query = supabase
      .from('question_banks')
      .select('*, question_count:question_bank_assignments(count)')
      .eq('id', id);

    if (filter._impossible) throw new AppError('NOT_FOUND');
    if (filter.or) {
      query = query.or(filter.or);
    } else if (filter.created_by) {
      query = query.eq('created_by', filter.created_by);
    }

    const { data: bank, error } = await query.single();
    if (error || !bank) throw new AppError('NOT_FOUND');

    const countArr = (bank as Record<string, unknown>).question_count as
      | { count: number }[]
      | undefined;
    return {
      ...bank,
      question_count: countArr?.[0]?.count ?? 0,
    } as unknown as QuestionBank;
  }

  async update(id: string, data: UpdateQuestionBankInput, ctx: RequestContext) {
    const supabase = await createClient();

    const { data: existing, error: fetchError } = await supabase
      .from('question_banks')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !existing) throw new AppError('NOT_FOUND');
    await checkPermission(ctx, Permission.QUESTION_BANK_UPDATE, existing);

    if (data.name !== undefined || data.description !== undefined) {
      const updateFields: Record<string, unknown> = {};
      if (data.name !== undefined) updateFields.name = data.name;
      if (data.description !== undefined) updateFields.description = data.description;

      const { data: bank, error } = await supabase
        .from('question_banks')
        .update(updateFields)
        .eq('id', id)
        .select()
        .single();

      if (error) throw mapSupabaseError(error);
      if (!bank) throw new AppError('NOT_FOUND');
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

  async delete(id: string, ctx: RequestContext) {
    const supabase = await createClient();

    const { data: existing, error: fetchError } = await supabase
      .from('question_banks')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !existing) throw new AppError('NOT_FOUND');
    await checkPermission(ctx, Permission.QUESTION_BANK_DELETE, existing);

    const { error } = await supabase.from('question_banks').delete().eq('id', id);
    if (error) throw mapSupabaseError(error);
  }

  async bulkCreate(data: BulkCreateQuestionBankInput, ctx: RequestContext) {
    const supabase = await createClient();
    const organizationId = (await shouldSetUniversityId(ctx, Permission.QUESTION_BANK_CREATE))
      ? ctx.activeOrgId
      : null;

    const banks = data.banks.map((b) => ({
      name: b.name,
      description: b.description ?? null,
      created_by: ctx.userId,
      organization_id: organizationId,
    }));

    const { data: created, error } = await supabase
      .from('question_banks')
      .insert(banks)
      .select('*');

    if (error) throw mapSupabaseError(error);
    return created;
  }

  async batchDelete(data: BatchDeleteQuestionBankInput, ctx: RequestContext) {
    const supabase = await createClient();

    const { data: banks, error: fetchError } = await supabase
      .from('question_banks')
      .select('*')
      .in('id', data.ids);

    if (fetchError) throw mapSupabaseError(fetchError);
    if (!banks || banks.length === 0) throw new AppError('NOT_FOUND');

    for (const bank of banks) {
      await checkPermission(ctx, Permission.QUESTION_BANK_DELETE, bank);
    }

    const { error } = await supabase.from('question_banks').delete().in('id', data.ids);
    if (error) throw mapSupabaseError(error);

    return { deleted: data.ids.length };
  }
}

export const questionBankService = new QuestionBankService();
