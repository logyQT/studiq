import type { RequestContext } from '@studiq/authz';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';
import { dbCount, dbRows } from '@studiq/server/lib/supabase/rows';
import {
  accessibleFilter,
  check,
  Permission,
  resolveGroupResourceIds,
} from '@studiq/server/lib/authz';
import { wrapService } from '@studiq/server/lib/observability';
import type {
  BatchDeleteQuestionBankInput,
  BulkCreateQuestionBankInput,
  CreateQuestionBankInput,
  QuestionBankListQuery,
  UpdateQuestionBankInput,
} from '@studiq/server/models/question-bank.model';
import {
  applyAccessFilter,
  pageParams,
  pageQuery,
  pickDefined,
  readPage,
} from '@studiq/server/lib/query-list';
import { failure, isFailure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { isImpossibleFilter } from '@studiq/server/lib/rbac-filter';
import { createClient } from '@studiq/server/lib/supabase/server';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import { groupService } from '@studiq/server/services/group.service';

/** `.in()` values travel in the request URL; ids are checked in chunks (matching the rest). */
const ID_CHUNK = 200;
import { limitsResolver } from '@studiq/server/services/limits.resolver';

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

    let query = applyAccessFilter(
      supabase
        .from('question_banks')
        .select('*, question_count:questions(count), bank_groups(group_id)'),
      filter,
    );

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

    const paging = pageParams(queryParams, { sortBy: 'created_at', limit: 24 });
    query = pageQuery(query, paging);

    return readPage(query, {
      ...paging,
      map: (item) => ({
        ...item,
        question_count: dbCount(item.question_count),
        groupIds: dbRows(item.bank_groups).map((g) => g.group_id),
      }),
    });
  }

  async getById(id: string, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.clientFactory();

    const filter = await accessibleFilter(ctx, Permission.QUESTION_BANK_READ, 'question_bank');
    if (isImpossibleFilter(filter)) return failure('NOT_FOUND');

    const { data: bank, error } = await applyAccessFilter(
      supabase
        .from('question_banks')
        .select('*, question_count:questions(count), bank_groups(group_id)')
        .eq('id', id),
      filter,
    ).maybeSingle();
    if (error || !bank) return failure('NOT_FOUND');

    return success({
      ...bank,
      question_count: dbCount(bank.question_count),
      groupIds: dbRows(bank.bank_groups).map((g) => g.group_id),
    });
  }

  async update(
    id: string,
    data: UpdateQuestionBankInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.clientFactory();

    const loaded = await this.loadForWrite(supabase, id, ctx, Permission.QUESTION_BANK_UPDATE);
    if (isFailure(loaded)) return loaded;
    const bank = loaded.data;

    const requestedGroupIds = data.groupIds !== undefined ? [...new Set(data.groupIds)] : null;
    if (requestedGroupIds !== null && requestedGroupIds.length > 0) {
      // The link must belong to the CONTENT's org, not the caller's current UI org.
      // NULL-org content (legacy personal rows) falls back to the active org.
      const contentOrgId = bank.organization_id ?? ctx.activeOrgId ?? null;
      const canShare = await groupService.canShareContentToGroups(
        ctx,
        requestedGroupIds,
        contentOrgId,
      );
      if (isFailure(canShare)) return failure(canShare.error);
      if (!canShare.data) return failure('FORBIDDEN');
    }

    const updateFields = pickDefined({
      name: data.name,
      description: data.description,
      visibility: data.visibility,
    });

    if (Object.keys(updateFields).length > 0) {
      const { error } = await supabase
        .from('question_banks')
        .update(updateFields)
        .eq('id', id)
        .select()
        .single();

      if (error) return toDbFailure(error);

      if (data.visibility !== undefined && data.visibility !== bank.visibility) {
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

    const loaded = await this.loadForWrite(supabase, id, ctx, Permission.QUESTION_BANK_DELETE);
    if (isFailure(loaded)) return loaded;

    const bound = await this.hasBoundAssessmentItems(supabase, [id]);
    if (isFailure(bound)) return bound;
    if (bound.data) return failure('CONFLICT');

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
    const ownedBanks = dbRows(banks);
    if (ownedBanks.length === 0) return failure('NOT_FOUND');

    for (const bank of ownedBanks) {
      await check(ctx, Permission.QUESTION_BANK_DELETE, bank);
    }

    const bound = await this.hasBoundAssessmentItems(
      supabase,
      ownedBanks.map((bank) => bank.id),
    );
    if (isFailure(bound)) return bound;
    if (bound.data) return failure('CONFLICT');

    const { error } = await supabase.from('question_banks').delete().in('id', data.ids);
    if (error) return toDbFailure(error);

    return success({ deleted: data.ids.length });
  }

  /**
   * Whether any item in these banks is bound to a non-draft assessment. Deleting the bank
   * cascades to `questions` and then to `assignment_questions`, which would destroy the frozen
   * snapshot a published assessment serves (#1171) — so the delete is refused instead.
   */
  private async hasBoundAssessmentItems(
    supabase: SupabaseClient<Database>,
    bankIds: readonly string[],
  ): Promise<ServiceResult<boolean>> {
    if (bankIds.length === 0) return success(false);

    const { data: questions, error } = await supabase
      .from('questions')
      .select('id')
      .in('bank_id', bankIds);
    if (error) return toDbFailure(error);

    const questionIds = dbRows(questions).map((question) => question.id);
    const assignmentIds = new Set<string>();
    for (let i = 0; i < questionIds.length; i += ID_CHUNK) {
      const { data: links, error: linkError } = await supabase
        .from('assignment_questions')
        .select('assignment_id')
        .in('question_id', questionIds.slice(i, i + ID_CHUNK));
      if (linkError) return toDbFailure(linkError);
      for (const link of dbRows(links)) {
        if (link.assignment_id) assignmentIds.add(link.assignment_id);
      }
    }
    if (assignmentIds.size === 0) return success(false);

    const ids = [...assignmentIds];
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      const { data: live, error: liveError } = await supabase
        .from('teacher_assignments')
        .select('id')
        .in('id', ids.slice(i, i + ID_CHUNK))
        .neq('status', 'draft')
        .limit(1);
      if (liveError) return toDbFailure(liveError);
      if (dbRows(live).length > 0) return success(true);
    }
    return success(false);
  }

  /**
   * Loads the bank a single-row write targets and enforces the caller's
   * permission on that row. A missing id is `NOT_FOUND` (never `FORBIDDEN`)
   * so the answer does not confirm that an unreadable bank exists.
   */
  private async loadForWrite(
    supabase: SupabaseClient<Database>,
    id: string,
    ctx: RequestContext,
    permission: string,
  ): Promise<ServiceResult<Database['public']['Tables']['question_banks']['Row']>> {
    const { data: existing, error } = await supabase
      .from('question_banks')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error || !existing) return failure('NOT_FOUND');
    await check(ctx, permission, existing);
    return success(existing);
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
