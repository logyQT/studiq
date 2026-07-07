import { AppError } from '@/lib/errors';
import { buildQueryFilter, Permission } from '@/lib/rbac';
import type { RequestContext } from '@/lib/request-context';
import { createClient } from '@/lib/supabase/server';
import { mapSupabaseError } from '@/lib/supabase-errors';
import type { CreateQuestionInput, UpdateQuestionInput } from '@/server/models';
import { checkLimit } from '@/server/services/plan.resolver';

export class QuestionService {
  async create(data: CreateQuestionInput, ctx: RequestContext) {
    const supabase = await createClient();

    const { count: questionCount } = await supabase
      .from('questions')
      .select('*', { count: 'exact', head: true })
      .eq('created_by', ctx.userId);
    await checkLimit(ctx, 'max_questions', questionCount ?? 0);

    const bankVisibility =
      data.bankIds && data.bankIds.length > 0
        ? ((
            await supabase
              .from('question_banks')
              .select('visibility')
              .in('id', data.bankIds)
              .limit(1)
          ).data?.[0]?.visibility ?? 'personal')
        : 'personal';

    const { data: question, error: qError } = await supabase
      .from('questions')
      .insert({
        type: data.type,
        content: data.content,
        explanation: data.explanation ?? null,
        created_by: ctx.userId,
        organization_id: ctx.activeOrgId,
        visibility: bankVisibility,
      })
      .select()
      .single();

    if (qError) throw mapSupabaseError(qError);
    if (!question) throw new AppError('NOT_FOUND');

    const answersToInsert = data.answers.map((a, i) => ({
      question_id: question.id,
      content: a.content,
      is_correct: a.isCorrect,
      order_index: a.orderIndex ?? i,
    }));

    const { error: aError } = await supabase.from('question_answers').insert(answersToInsert);
    if (aError) throw mapSupabaseError(aError);

    if (data.bankIds && data.bankIds.length > 0) {
      const bankAssignments = data.bankIds.map((bankId) => ({
        question_id: question.id,
        bank_id: bankId,
      }));
      const { error: bError } = await supabase
        .from('question_bank_assignments')
        .insert(bankAssignments);
      if (bError) throw mapSupabaseError(bError);
    }

    if (data.topicIds && data.topicIds.length > 0) {
      const topicAssignments = data.topicIds.map((topicId) => ({
        question_id: question.id,
        topic_id: topicId,
      }));
      const { error: tError } = await supabase
        .from('question_topic_assignments')
        .insert(topicAssignments);
      if (tError) throw mapSupabaseError(tError);
    }

    return this.getById(question.id, ctx);
  }

  async list(ctx: RequestContext, filters?: { bankId?: string; topicIds?: string; type?: string }) {
    const supabase = await createClient();

    const filter = await buildQueryFilter(ctx, Permission.QUESTION_READ, 'question');

    if (filter._useRpc) {
      const rpcParams: Record<string, unknown> = {
        p_user_id: ctx.userId,
        p_org_id: ctx.activeOrgId,
      };
      if (filters?.bankId) rpcParams.p_bank_ids = [filters.bankId];
      if (filters?.topicIds) rpcParams.p_topic_ids = filters.topicIds.split(',');
      const { data, error } = await supabase.rpc('get_accessible_questions', rpcParams);
      if (error) throw mapSupabaseError(error);
      return data ?? [];
    }

    let query = supabase
      .from('questions')
      .select('*, question_answers(*)')
      .order('created_at', { ascending: false });

    if (filter._impossible) return [];
    if (filter.created_by) query = query.eq('created_by', filter.created_by);
    if (filter.organization_id) query = query.eq('organization_id', filter.organization_id);

    if (filters?.bankId) {
      const { data: bankAssignments } = await supabase
        .from('question_bank_assignments')
        .select('question_id')
        .eq('bank_id', filters.bankId);

      const questionIds = bankAssignments?.map((a) => a.question_id) ?? [];
      if (questionIds.length === 0) return [];
      query = query.in('id', questionIds);
    }

    if (filters?.topicIds) {
      const topicIdArray = filters.topicIds.split(',');
      const { data: topicAssignments } = await supabase
        .from('question_topic_assignments')
        .select('question_id')
        .in('topic_id', topicIdArray);

      const questionIds = topicAssignments?.map((a) => a.question_id) ?? [];
      if (questionIds.length === 0) return [];
      query = query.in('id', questionIds);
    }

    if (filters?.type) query = query.eq('type', filters.type);

    const { data, error } = await query;

    if (error) throw mapSupabaseError(error);
    return data;
  }

  async getById(id: string, ctx: RequestContext) {
    const supabase = await createClient();

    const filter = await buildQueryFilter(ctx, Permission.QUESTION_READ, 'question');
    if (filter._impossible) throw new AppError('NOT_FOUND');

    if (filter._useRpc) {
      const { data, error } = await supabase
        .rpc('get_accessible_questions', {
          p_user_id: ctx.userId,
          p_org_id: ctx.activeOrgId,
        })
        .eq('id', id)
        .single();
      if (error) throw new AppError('NOT_FOUND');
      return data;
    }

    const { data, error } = await supabase
      .from('questions')
      .select('*, question_answers(*)')
      .eq('id', id)
      .single();

    if (error || !data) throw new AppError('NOT_FOUND');
    return data;
  }

  async update(id: string, data: UpdateQuestionInput, ctx: RequestContext) {
    const supabase = await createClient();

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

    if (qError && qError.code !== 'PGRST116') throw mapSupabaseError(qError);
    if (!question || (Array.isArray(question) && question.length === 0))
      throw new AppError('FORBIDDEN');

    if (data.answers) {
      await supabase.from('question_answers').delete().eq('question_id', id);
      const answersToInsert = data.answers.map((a, i) => ({
        question_id: id,
        content: a.content,
        is_correct: a.isCorrect,
        order_index: a.orderIndex ?? i,
      }));
      await supabase.from('question_answers').insert(answersToInsert);
    }

    if (data.bankIds !== undefined) {
      await supabase.from('question_bank_assignments').delete().eq('question_id', id);
      if (data.bankIds.length > 0) {
        const bankAssignments = data.bankIds.map((bankId) => ({
          question_id: id,
          bank_id: bankId,
        }));
        await supabase.from('question_bank_assignments').insert(bankAssignments);
      }
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

  async delete(id: string, ctx: RequestContext) {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('questions')
      .delete()
      .eq('id', id)
      .eq('created_by', ctx.userId)
      .select()
      .single();

    if (error && error.code !== 'PGRST116') throw mapSupabaseError(error);
    if (!data || (Array.isArray(data) && data.length === 0)) throw new AppError('FORBIDDEN');
  }
}

export const questionService = new QuestionService();
