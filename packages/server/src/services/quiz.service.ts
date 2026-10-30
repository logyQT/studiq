import type { RequestContext } from '@studiq/authz';
import { accessibleFilter, Permission } from '@studiq/server/lib/authz';
import { wrapService } from '@studiq/server/lib/observability';
import { IN_PROGRESS_QUESTION_SELECT } from '@studiq/server/lib/question-view';
import { failure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { createClient } from '@studiq/server/lib/supabase/server';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type { GenerateQuizInput } from '@studiq/server/models/quiz.model';
import { limitsResolver } from '@studiq/server/services/limits.resolver';
import type { SupabaseClient } from '@supabase/supabase-js';

export class QuizService {
  constructor(private createClient: () => Promise<SupabaseClient>) {}

  async generateQuiz(
    config: GenerateQuizInput,
    ctx: RequestContext,
  ): Promise<ServiceResult<unknown>> {
    const supabase = await this.createClient();

    const filter = await accessibleFilter(ctx, Permission.QUESTION_READ, 'question');
    if (filter._impossible) return success({ questions: [], attemptId: '' });

    // Daily practice-quiz quota: count only attempts started today that are not
    // part of a teacher assignment (assignment attempts are capped by
    // `teacher_assignments.max_attempts` instead).
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);

    const { count: attemptsToday } = await supabase
      .from('quiz_attempts')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', ctx.userId)
      // The durable marker: a finished attempt of a since-deleted assignment is not practice
      // and must not consume the daily practice quota (#657).
      .eq('is_assignment_attempt', false)
      .gte('started_at', dayStart.toISOString());

    await limitsResolver.checkLimit(ctx, 'max_quiz_attempts_per_day', attemptsToday ?? 0);

    let query = supabase.from('questions').select(IN_PROGRESS_QUESTION_SELECT);

    if (filter.or) query = query.or(filter.or);
    if (filter.created_by) query = query.eq('created_by', filter.created_by);
    if (filter.organization_id) query = query.eq('organization_id', filter.organization_id);

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
      // A topic can exist without any matching questions (topics are shared with
      // flashcards). Fail like every other empty result so the client shows its
      // „no questions found” toast instead of navigating to an empty attempt.
      if (ids.length === 0) return failure('NOT_FOUND');
      query = query.in('id', ids);
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
        // Durable provenance for the student insights (#657): a practice quiz is never an
        // assignment attempt, not even when the bulk insert below mixes both kinds of row.
        is_assignment_attempt: false,
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
export const quizService = wrapService(new QuizService(createClient), 'quiz.service');
