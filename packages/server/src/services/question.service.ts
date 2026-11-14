import type { RequestContext } from '@studiq/authz';
import { accessibleFilter, Permission } from '@studiq/server/lib/authz';
import { wrapService } from '@studiq/server/lib/observability';
import { applyAccessFilter } from '@studiq/server/lib/query-list';
import type { FilterableBuilderWithExtra } from '@studiq/server/lib/postgrest';
import {
  canReadQuestionKey,
  readQuestionKeys,
  type QuestionKeyResource,
  withAnswerKey,
} from '@studiq/server/lib/question-keys';
import { OPTION_READER_COLUMNS } from '@studiq/server/lib/question-view';
import { isImpossibleFilter } from '@studiq/server/lib/rbac-filter';
import { failure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { createClient } from '@studiq/server/lib/supabase/server';
import { dbRows } from '@studiq/server/lib/supabase/rows';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type {
  CreateQuestionInput,
  QuestionListQuery,
  UpdateQuestionInput,
} from '@studiq/server/models/question.model';
import { limitsResolver } from '@studiq/server/services/limits.resolver';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';

/** Shape of the `question_topic_assignments(topic_id, topics(id, name))` embed. */
type QuestionTopicLink = {
  topic_id: string;
  topics: { id: string; name: string } | null;
};

/** A question with its answers and flattened readable topics — the staff export shape. */
export type QuestionWithAnswers = Omit<
  Database['public']['Tables']['questions']['Row'],
  'search_vector'
> & {
  question_answers: Array<
    Omit<Database['public']['Tables']['question_options']['Row'], 'question_id'>
  >;
  topics: Array<{ id: string; name: string }>;
};

/**
 * Flattens the assignment embed into the `topics` array the client renders.
 * Topics the caller cannot read (RLS) come back as `null` and are dropped.
 */
function withTopics<T extends { question_topic_assignments?: QuestionTopicLink[] | null }>(
  row: T,
): Omit<T, 'question_topic_assignments'> & { topics: Array<{ id: string; name: string }> } {
  const { question_topic_assignments, ...rest } = row;
  return {
    ...rest,
    topics: (question_topic_assignments ?? [])
      .map((link) => link.topics)
      .filter((topic): topic is { id: string; name: string } => topic != null),
  };
}

/**
 * The question columns every reader may see. `explanation` and `search_vector` are left out:
 * the explanation is part of the key the staff reader adds back, and the search vector indexes
 * it, so a reader payload cannot carry either.
 */
const QUESTION_COLUMNS =
  'id, type, content, visibility, created_by, organization_id, bank_id, created_at, updated_at';

/**
 * Reader-safe read projection. `!inner` is required when filtering by topic, so the embed
 * narrows parent rows instead of only filtering the nested array. Staff rows gain
 * `explanation` and `is_correct` afterwards, from the service-role key reader.
 */
const QUESTION_SELECT =
  `${QUESTION_COLUMNS}, question_answers:question_options(${OPTION_READER_COLUMNS}), question_topic_assignments(topic_id, topics(id, name))` as const;
const QUESTION_SELECT_BY_TOPIC =
  `${QUESTION_COLUMNS}, question_answers:question_options(${OPTION_READER_COLUMNS}), question_topic_assignments!inner(topic_id, topics(id, name))` as const;

/**
 * Adds the answer key and the explanation to the rows the caller may read them for. Every
 * other row is returned untouched, so a reader payload carries no `is_correct` and no
 * `explanation` at all (absent, not null) — R4.
 */
async function withKeys<
  T extends { id: string; question_answers: readonly { id: string }[] } & QuestionKeyResource,
>(rows: T[], ctx: RequestContext): Promise<T[]> {
  const keyedIds = new Set(rows.filter((row) => canReadQuestionKey(ctx, row)).map((row) => row.id));
  if (keyedIds.size === 0) return rows;

  const keys = await readQuestionKeys([...keyedIds]);
  return rows.map((row) => (keyedIds.has(row.id) ? withAnswerKey(row, keys.get(row.id)) : row));
}

/**
 * `%`, `_` and `\` are wildcards / escapes in LIKE: a search for "50%" must mean the text. PostgREST
 *
 * PostgREST turns every `*` of an `ilike` value into `%` BEFORE the pattern reaches SQL, so an
 * escaped `\*` would arrive as an escaped literal `%` and never match a `*`. A `*` in the search
 * therefore becomes the single-character wildcard `_`: it still matches the literal `*` (and,
 * harmlessly, any other character in that place).
 */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/\*/g, '_');
}

export class QuestionService {
  constructor(private clientFactory: () => Promise<SupabaseClient<Database>>) {}

  async create(
    data: CreateQuestionInput,
    ctx: RequestContext,
    bankVisibility?: string,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.clientFactory();

    const questionCount = await this.countOwned(supabase, ctx);
    await limitsResolver.checkLimit(ctx, 'max_questions', questionCount);

    // `questions.visibility` is the two-value `visibility_type` enum. The bank's
    // visibility arrives as a plain string; anything but `group` means the
    // personal default this insert always used.
    const visibility: Database['public']['Enums']['visibility_type'] =
      bankVisibility === 'group' ? 'group' : 'personal';

    const { data: question, error: qError } = await supabase
      .from('questions')
      .insert({
        type: data.type,
        content: data.content,
        explanation: data.explanation ?? null,
        created_by: ctx.userId,
        organization_id: ctx.activeOrgId,
        visibility,
        bank_id: data.bankId,
      })
      .select()
      .single();

    if (qError) return toDbFailure(qError);

    if (data.answers.length > 0) {
      const answersToInsert = data.answers.map((a) => ({
        question_id: question.id,
        content: a.content,
        is_correct: a.isCorrect,
        order_index: a.orderIndex,
      }));

      const { error: aError } = await supabase.from('question_options').insert(answersToInsert);
      if (aError) return toDbFailure(aError);
    }

    if (data.topicIds && data.topicIds.length > 0) {
      const topicAssignments = data.topicIds.map((topicId) => ({
        question_id: question.id,
        topic_id: topicId,
      }));
      const { error: tError } = await supabase
        .from('question_topic_assignments')
        .insert(topicAssignments);
      if (tError) return toDbFailure(tError);
    }

    return this.getById(question.id, ctx);
  }

  async list(
    ctx: RequestContext,
    filters?: Partial<QuestionListQuery>,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.clientFactory();

    const page = filters?.page;
    const limit = filters?.limit ?? 25;
    const paged = page !== undefined;

    const filter = await accessibleFilter(ctx, Permission.QUESTION_READ, 'question');
    if (isImpossibleFilter(filter))
      return success(paged ? { items: [], total: 0, page, limit } : []);

    const topicIds = filters?.topicIds ?? [];
    const hasTopicFilter = topicIds.length > 0;
    const columns = hasTopicFilter ? QUESTION_SELECT_BY_TOPIC : QUESTION_SELECT;

    // One place applies the filter chain, so the rows of a page and the total that drives the
    // pager can never be scoped differently.
    const applyFilters = <T extends FilterableBuilderWithExtra<T>>(q: T): T => {
      let query = applyAccessFilter(q, filter);

      if (filters?.bankId) query = query.eq('bank_id', filters.bankId);
      // The topic embed must be `!inner` for the filter to narrow the parent rows —
      // a plain embed only filters the nested array (same approach as flashcard.service).
      if (hasTopicFilter)
        query = query.filter(
          'question_topic_assignments.topic_id',
          'in',
          `(${topicIds.join(',')})`,
        );
      if (filters?.type) query = query.eq('type', filters.type);
      if (filters?.search) query = query.ilike('content', `%${escapeLike(filters.search)}%`);
      return query;
    };

    let query = applyFilters(
      paged
        ? supabase.from('questions').select(columns, { count: 'exact' })
        : supabase.from('questions').select(columns),
    );

    if (filters?.sortBy || paged) {
      // `id` as the tie-breaker keeps pages stable when many rows share the sort value.
      query = query
        .order(filters?.sortBy ?? 'created_at', { ascending: filters?.sortOrder === 'asc' })
        .order('id');
    }
    if (paged) query = query.range((page - 1) * limit, page * limit - 1);

    const { data, error, count } = await query;
    // PostgREST answers a range past the last row with PGRST103 (416). A page that no longer
    // exists (rows deleted, stale link) is an empty page, not a server error — but the set it
    // paged through still has rows, so the answer carries the real total (the pager clamps to
    // the last page from it).
    if (paged && error?.code === 'PGRST103') {
      const { count: total, error: countError } = await applyFilters(
        supabase.from('questions').select(columns, { count: 'exact', head: true }),
      );
      if (countError) return toDbFailure(countError);
      return success({ items: [], total: total ?? 0, page, limit });
    }
    if (error) return toDbFailure(error);
    const rows = dbRows(data);
    const items = await withKeys(
      rows.map((row) => withTopics(row)),
      ctx,
    );
    return success(paged ? { items, total: count ?? items.length, page, limit } : items);
  }

  /**
   * Every question of one bank, in the full shape an export needs, **without** the
   * `question.read` scope filter, plus the exact number of rows the query matched.
   *
   * The caller must already have checked `question_bank.read` **and** the staff key
   * permission on this bank: reading a bank means reading the whole bank, answer key included
   * (decision B, #678), so the rows are returned with their key through the service-role
   * reader. Reading the questions through `list` instead would apply a second, narrower scope —
   * a role that may read the bank at `organization` scope but questions only at `own` would get
   * a partial file. RLS still bounds the rows to the caller's own or same-organisation questions.
   *
   * `total` is the `count` of the same query, so it stays right when PostgREST clamps the rows at
   * its `max_rows`: `rows.length < total` means the result was cut, not that the bank is smaller.
   */
  async listBankQuestions(
    bankId: string,
  ): Promise<ServiceResult<{ questions: QuestionWithAnswers[]; total: number }>> {
    const supabase = await this.clientFactory();

    const { data, error, count } = await supabase
      .from('questions')
      .select(QUESTION_SELECT, { count: 'exact' })
      .eq('bank_id', bankId);
    if (error) return toDbFailure(error);

    const rows = dbRows(data);
    const keys = await readQuestionKeys(rows.map((row) => row.id));
    const questions: QuestionWithAnswers[] = rows.map((row) => {
      const key = keys.get(row.id);
      const question = withTopics(row);
      return {
        ...question,
        explanation: key?.explanation ?? null,
        question_answers: question.question_answers.map((option) => ({
          ...option,
          is_correct: key?.correctOptionIds.includes(option.id) ?? false,
        })),
      };
    });
    return success({ questions, total: count ?? rows.length });
  }

  async getById(id: string, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.clientFactory();

    const filter = await accessibleFilter(ctx, Permission.QUESTION_READ, 'question');
    if (isImpossibleFilter(filter)) return failure('NOT_FOUND');

    const { data: question, error } = await applyAccessFilter(
      supabase.from('questions').select(QUESTION_SELECT).eq('id', id),
      filter,
    ).maybeSingle();
    if (error || !question) return failure('NOT_FOUND');

    const [item] = await withKeys([withTopics(question)], ctx);
    return success(item);
  }

  async update(
    id: string,
    data: UpdateQuestionInput,
    ctx: RequestContext,
    bankVisibility?: string,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.clientFactory();

    const updateFields: Database['public']['Tables']['questions']['Update'] = {};
    if (data.type) updateFields.type = data.type;
    if (data.content) updateFields.content = data.content;
    if (data.explanation !== undefined) updateFields.explanation = data.explanation;

    let updateQuery = supabase
      .from('questions')
      .update(updateFields)
      .eq('id', id)
      .eq('created_by', ctx.userId);

    // questions.organization_id is nullable (personal questions). Mirror `accessibleFilter`'s
    // `own` scope: apply the tenant filter only while an org is active. A bare
    // .eq('organization_id', null) serialises to `eq.null` → 22P02 → 500 (#148).
    if (ctx.activeOrgId) updateQuery = updateQuery.eq('organization_id', ctx.activeOrgId);

    const { data: question, error: qError } = await updateQuery.select().single();

    if (qError && qError.code !== 'PGRST116') return toDbFailure(qError);
    if (!question || (Array.isArray(question) && question.length === 0))
      return failure('FORBIDDEN');

    if (data.answers) {
      await supabase.from('question_options').delete().eq('question_id', id);
      if (data.answers.length > 0) {
        const answersToInsert = data.answers.map((a) => ({
          question_id: id,
          content: a.content,
          is_correct: a.isCorrect,
          order_index: a.orderIndex,
        }));
        await supabase.from('question_options').insert(answersToInsert);
      }
    }

    if (data.bankId !== undefined) {
      const bFields: Database['public']['Tables']['questions']['Update'] = { bank_id: data.bankId };
      if (bankVisibility !== undefined) {
        bFields.visibility = bankVisibility === 'group' ? 'group' : 'personal';
      }
      const { error: bError } = await supabase.from('questions').update(bFields).eq('id', id);
      if (bError) return toDbFailure(bError);
    }

    if (data.topicIds !== undefined) {
      await supabase.from('question_topic_assignments').delete().eq('question_id', id);
      if (data.topicIds.length > 0) {
        const topicAssignments = data.topicIds.map((topicId) => ({
          question_id: id,
          topic_id: topicId,
        }));
        await supabase.from('question_topic_assignments').insert(topicAssignments);
      }
    }

    return this.getById(id, ctx);
  }

  async delete(id: string, ctx: RequestContext): Promise<ServiceResult<void>> {
    const supabase = await this.clientFactory();

    const { data, error } = await supabase
      .from('questions')
      .delete()
      .eq('id', id)
      .eq('created_by', ctx.userId)
      .select()
      .single();

    if (error && error.code !== 'PGRST116') return toDbFailure(error);
    if (!data || (Array.isArray(data) && data.length === 0)) return failure('FORBIDDEN');

    return success(undefined);
  }

  /**
   * Count the caller's questions for the limit check (#233): inside an org the
   * count is scoped to content owned by the caller **in that org**, so
   * personal-space questions never consume the org plan's capacity.
   */
  private async countOwned(
    supabase: SupabaseClient<Database>,
    ctx: RequestContext,
  ): Promise<number> {
    let query = supabase
      .from('questions')
      .select('*', { count: 'exact', head: true })
      .eq('created_by', ctx.userId);

    if (ctx.activeOrgId) query = query.eq('organization_id', ctx.activeOrgId);

    const { count } = await query;
    return count ?? 0;
  }
}
export const questionService = wrapService(new QuestionService(createClient), 'question.service');
