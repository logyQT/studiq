import type { SupabaseClient } from '@supabase/supabase-js';
import { accessibleFilter, Permission } from '@/lib/authz';
import { wrapService } from '@/lib/observability';
import type { RequestContext } from '@/lib/request-context';
import { failure, type ServiceResult, success } from '@/lib/service-result';
import { createClient } from '@/lib/supabase/server';
import { toDbFailure } from '@/lib/supabase-errors';
import type { CreateQuestionInput, UpdateQuestionInput } from '@/server/models/question.model';
import { limitsResolver } from '@/server/services/limits.resolver';

export class QuestionService {
  constructor(private createClient: () => Promise<SupabaseClient>) {}

  async create(
    data: CreateQuestionInput,
    ctx: RequestContext,
    bankVisibility?: string,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const { count: questionCount } = await supabase
      .from('questions')
      .select('*', { count: 'exact', head: true })
      .eq('created_by', ctx.userId);
    await limitsResolver.checkLimit(ctx, 'max_questions', questionCount ?? 0);

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

    const answersToInsert = data.answers.map((a, i) => ({
      question_id: question.id,
      content: a.content,
      is_correct: a.isCorrect,
      order_index: a.orderIndex ?? i,
    }));

    const { error: aError } = await supabase.from('question_options').insert(answersToInsert);
    if (aError) return toDbFailure(aError);

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
    filters?: { bankId?: string; topicIds?: string; type?: string },
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const filter = await accessibleFilter(ctx, Permission.QUESTION_READ, 'question');
    if (filter._impossible) return success([]);

    let query = supabase
      .from('questions')
      .select('*, question_answers:question_options(*), question_topic_assignments(topic_id)');

    if (filter.or) query = query.or(filter.or);
    if (filter.created_by) query = query.eq('created_by', filter.created_by);
    if (filter.organization_id) query = query.eq('organization_id', filter.organization_id);

    if (filters?.bankId) query = query.eq('bank_id', filters.bankId);
    if (filters?.topicIds)
      query = query.filter(
        'question_topic_assignments.topic_id',
        'in',
        `(${filters.topicIds.split(',').join(',')})`,
      );
    if (filters?.type) query = query.eq('type', filters.type);

    const { data, error } = await query;
    if (error) return toDbFailure(error);
    return success(data ?? []);
  }

  async getById(id: string, ctx: RequestContext): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const filter = await accessibleFilter(ctx, Permission.QUESTION_READ, 'question');
    if (filter._impossible) return failure('NOT_FOUND');

    let query = supabase
      .from('questions')
      .select('*, question_answers:question_options(*), question_topic_assignments(topic_id)')
      .eq('id', id);

    if (filter.or) query = query.or(filter.or);
    if (filter.created_by) query = query.eq('created_by', filter.created_by);
    if (filter.organization_id) query = query.eq('organization_id', filter.organization_id);

    const { data: question, error } = await query.single();
    if (error || !question) return failure('NOT_FOUND');
    return success(question);
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

    const { data: question, error: qError } = await supabase
      .from('questions')
      .update(updateFields)
      .eq('id', id)
      .eq('created_by', ctx.userId)
      .eq('organization_id', ctx.activeOrgId)
      .select()
      .single();

    if (qError && qError.code !== 'PGRST116') return toDbFailure(qError);
    if (!question || (Array.isArray(question) && question.length === 0))
      return failure('FORBIDDEN');

    if (data.answers) {
      await supabase.from('question_options').delete().eq('question_id', id);
      const answersToInsert = data.answers.map((a, i) => ({
        question_id: id,
        content: a.content,
        is_correct: a.isCorrect,
        order_index: a.orderIndex ?? i,
      }));
      await supabase.from('question_options').insert(answersToInsert);
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
}
export const questionService = wrapService(new QuestionService(createClient), 'question.service');
