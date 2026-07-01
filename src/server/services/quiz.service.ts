import { AppError } from '@/lib/errors';
import { log } from '@/lib/logger';
import type { RequestContext } from '@/lib/request-context';
import { createClient } from '@/lib/supabase/server';
import { mapSupabaseError } from '@/lib/supabase-errors';
import type { GenerateQuizInput } from '@/server/models';

export class QuizService {
  async generateQuiz(config: GenerateQuizInput, ctx: RequestContext) {
    const supabase = await createClient();

    const orConditions = [];

    if (ctx.activeOrgId) orConditions.push(`organization_id.eq.${ctx.activeOrgId}`);
    if (ctx.userId) orConditions.push(`created_by.eq.${ctx.userId}`);

    let query = supabase.from('questions').select('*, question_answers(*)');

    if (orConditions.length > 0) {
      query = query.or(orConditions.join(','));
    }

    query = query.in('type', config.questionTypes);

    if (config.subjectId) {
      query = query.eq('subject_id', config.subjectId);
    }

    const { data: allQuestions, error: fetchError } = await query;
    log.trace.info('quiz_questions_fetched', {
      metadata: {
        traceId: ctx.traceId,
        count: allQuestions?.length ?? 0,
        questionTypes: config.questionTypes,
        subjectId: config.subjectId,
      },
    });
    if (fetchError) throw mapSupabaseError(fetchError);
    if (!allQuestions || allQuestions.length === 0) {
      throw new AppError('NOT_FOUND');
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

    if (attemptError) {
      log.trace.error('quiz_attempt_insert_failed', {
        metadata: {
          traceId: ctx.traceId,
          code: attemptError.code,
          message: attemptError.message,
          details: attemptError.details,
          hint: attemptError.hint,
        },
      });
      throw mapSupabaseError(attemptError);
    }
    if (!attempt) throw new AppError('NOT_FOUND');

    const attemptQuestions = selectedQuestions.map((q, i) => ({
      attempt_id: attempt.id,
      question_id: q.id,
      order_index: i,
    }));

    const { error: questionsError } = await supabase
      .from('quiz_attempt_questions')
      .insert(attemptQuestions);

    if (questionsError) {
      log.trace.error('quiz_attempt_questions_insert_failed', {
        metadata: {
          traceId: ctx.traceId,
          code: questionsError.code,
          message: questionsError.message,
          details: questionsError.details,
          hint: questionsError.hint,
        },
      });
      throw mapSupabaseError(questionsError);
    }

    return {
      ...attempt,
      questions: selectedQuestions,
    };
  }
}

export const quizService = new QuizService();
