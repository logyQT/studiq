import type { RequestContext } from '@studiq/authz';
import { accessibleFilter, Permission } from '@studiq/server/lib/authz';
import { wrapService } from '@studiq/server/lib/observability';
import { failure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { createClient } from '@studiq/server/lib/supabase/server';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type {
  CreateQuestionInput,
  QuestionListQuery,
  UpdateQuestionInput,
} from '@studiq/server/models/question.model';
import { limitsResolver } from '@studiq/server/services/limits.resolver';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Shape of the `question_topic_assignments(topic_id, topics(id, name))` embed. */
type QuestionTopicLink = {
  topic_id: string;
  topics: { id: string; name: string } | null;
};

type QuestionTopicRow = {
  question_topic_assignments?: QuestionTopicLink[] | null;
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
 * Question read projection. `!inner` is required when filtering by topic, so
 * the embed narrows parent rows instead of only filtering the nested array.
 */
function questionSelect(topicFilter = false) {
  const embed = `question_topic_assignments${topicFilter ? '!inner' : ''}(topic_id, topics(id, name))`;
  return `*, question_answers:question_options(*), ${embed}`;
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
  constructor(private createClient: () => Promise<SupabaseClient>) {}

  async create(
    data: CreateQuestionInput,
    ctx: RequestContext,
    bankVisibility?: string,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const questionCount = await this.countOwned(supabase, ctx);
    await limitsResolver.checkLimit(ctx, 'max_questions', questionCount);

    const visibility = bankVisibility ?? 'personal';

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
    if (!question) return failure('NOT_FOUND');

    if (data.answers.length > 0) {
      const answersToInsert = data.answers.map((a, i) => ({
        question_id: question.id,
        content: a.content,
        is_correct: a.isCorrect,
        order_index: a.orderIndex ?? i,
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
    const supabase = await this.createClient();

    const page = filters?.page;
    const limit = filters?.limit ?? 25;
    const paged = page !== undefined;

    const filter = await accessibleFilter(ctx, Permission.QUESTION_READ, 'question');
    if (filter._impossible) return success(paged ? { items: [], total: 0, page, limit } : []);

    const topicIds = filters?.topicIds ?? [];
    const hasTopicFilter = topicIds.length > 0;
    const columns = questionSelect(hasTopicFilter);

    // One place builds the filter chain, so the rows of a page and the total that drives the
    // pager can never be scoped differently.
    const buildFiltered = (options?: { count: 'exact'; head?: boolean }) => {
      let query = options
        ? supabase.from('questions').select(columns, options)
        : supabase.from('questions').select(columns);

      if (filter.or) query = query.or(filter.or);
      if (filter.created_by) query = query.eq('created_by', filter.created_by);
      if (filter.organization_id) query = query.eq('organization_id', filter.organization_id);

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

    let query = buildFiltered(paged ? { count: 'exact' } : undefined);

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
      const { count: total, error: countError } = await buildFiltered({
        count: 'exact',
        head: true,
      });
      if (countError) return toDbFailure(countError);
      return success({ items: [], total: total ?? 0, page, limit });
    }
    if (error) return toDbFailure(error);
    // `select()` receives a dynamic projection string, so PostgREST cannot infer
    // the row shape here; the cast matches the embed declared above.
    const rows = (data ?? []) as unknown as QuestionTopicRow[];
    const items = rows.map((row) => withTopics(row));
    return success(paged ? { items, total: count ?? items.length, page, limit } : items);
  }

  async getById(id: string, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const filter = await accessibleFilter(ctx, Permission.QUESTION_READ, 'question');
    if (filter._impossible) return failure('NOT_FOUND');

    let query = supabase.from('questions').select(questionSelect()).eq('id', id);

    if (filter.or) query = query.or(filter.or);
    if (filter.created_by) query = query.eq('created_by', filter.created_by);
    if (filter.organization_id) query = query.eq('organization_id', filter.organization_id);

    const { data: question, error } = await query.single();
    if (error || !question) return failure('NOT_FOUND');
    return success(withTopics(question as unknown as QuestionTopicRow));
  }

  async update(
    id: string,
    data: UpdateQuestionInput,
    ctx: RequestContext,
    bankVisibility?: string,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const updateFields: Record<string, unknown> = {};
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
        const answersToInsert = data.answers.map((a, i) => ({
          question_id: id,
          content: a.content,
          is_correct: a.isCorrect,
          order_index: a.orderIndex ?? i,
        }));
        await supabase.from('question_options').insert(answersToInsert);
      }
    }

    if (data.bankId !== undefined) {
      const bFields: Record<string, unknown> = { bank_id: data.bankId };
      if (bankVisibility !== undefined) bFields.visibility = bankVisibility;
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
    const supabase = await this.createClient();

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
  private async countOwned(supabase: SupabaseClient, ctx: RequestContext): Promise<number> {
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
