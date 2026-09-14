import type { SupabaseClient } from '@supabase/supabase-js';
import type { RequestContext } from '@/lib/request-context';
import { failure, type ServiceResult, success } from '@/lib/service-result';
import { toDbFailure } from '@/lib/supabase-errors';
import type { GenerateQuizInput } from '@/server/models';

export class QuizService {
  constructor(private createClient: () => Promise<SupabaseClient>) {}

  async generateQuiz(
    config: GenerateQuizInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const orConditions = [];

    if (ctx.activeOrgId) orConditions.push(`organization_id.eq.${ctx.activeOrgId}`);
    if (ctx.userId) orConditions.push(`created_by.eq.${ctx.userId}`);

    let query = supabase.from('questions').select('*, question_answers:question_options(*)');

    if (orConditions.length > 0) {
      query = query.or(orConditions.join(','));
    }

    query = query.in('type', config.questionTypes);

    if (config.bankId) {
      query = query.eq('bank_id', config.bankId);
    }

    if (config.topicIds && config.topicIds.length > 0) {
      const { data: topicQuestionIds } = await supabase
        .from('question_topic_assignments')
        .select('question_id')
        .in('topic_id', config.topicIds);

      const ids = topicQuestionIds?.map((t) => t.question_id) ?? [];
      if (ids.length > 0) {
        query = query.in('id', ids);
      } else {
        return success({ questions: [], attemptId: '' });
      }
    }

    const { data: allQuestions, error: fetchError } = await query;
    if (fetchError) return toDbFailure(fetchError);
    if (!allQuestions || allQuestions.length === 0) {
      return failure('NOT_FOUND');
    }

    const shuffled = [...allQuestions].sort(() => Math.random() - 0.5);
    const selectedQuestions = shuffled.slice(0, Math.min(config.questionCount, shuffled.length));

    const { data: attempt, error: attemptError } = await supabase
      .from('quiz_attempts')
      .insert({
        user_id: ctx.userId,
        score: 0,
        total_questions: selectedQuestions.length,
        config: config as unknown as Record<string, unknown>,
        completed_at: null,
      })
      .select()
      .single();

    if (attemptError) return toDbFailure(attemptError);
    if (!attempt) return failure('NOT_FOUND');

    const attemptQuestions = selectedQuestions.map((q, i) => ({
      attempt_id: attempt.id,
      question_id: q.id,
      order_index: i,
    }));

    const { error: questionsError } = await supabase
      .from('quiz_attempt_questions')
      .insert(attemptQuestions);

    if (questionsError) return toDbFailure(questionsError);

    return success({
      ...attempt,
      questions: selectedQuestions,
    });
  }
}
