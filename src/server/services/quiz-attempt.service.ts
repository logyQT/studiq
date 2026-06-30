import { AppError } from '@/lib/errors';
import type { RequestContext } from '@/lib/request-context';
import { createClient } from '@/lib/supabase/server';
import { mapSupabaseError } from '@/lib/supabase-errors';
import type { SubmitQuizAttemptInput } from '@/server/models';

export class QuizAttemptService {
  async list(ctx: RequestContext) {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('quiz_attempts')
      .select('*')
      .eq('user_id', ctx.userId)
      .order('started_at', { ascending: false });

    if (error) throw mapSupabaseError(error);
    return data;
  }

  async getById(attemptId: string, ctx: RequestContext) {
    const supabase = await createClient();

    const { data: attempt, error: attemptError } = await supabase
      .from('quiz_attempts')
      .select('*')
      .eq('id', attemptId)
      .eq('user_id', ctx.userId)
      .single();

    if (attemptError || !attempt) throw new AppError('NOT_FOUND');

    const { data: attemptQuestions, error: questionsError } = await supabase
      .from('quiz_attempt_questions')
      .select('order_index, question_id, questions(*, question_answers(*))')
      .eq('attempt_id', attemptId)
      .order('order_index', { ascending: true });

    if (questionsError) throw mapSupabaseError(questionsError);

    const { data: answers, error: answersError } = await supabase
      .from('quiz_answers')
      .select('*')
      .eq('attempt_id', attemptId);

    if (answersError) throw mapSupabaseError(answersError);

    const questions = (attemptQuestions ?? [])
      .sort((a, b) => a.order_index - b.order_index)
      .map((aq) => aq.questions);

    const answerObj: Record<string, { selected_answer_id: string | null; is_correct: boolean }> =
      {};
    (answers ?? []).forEach((a) => {
      answerObj[a.question_id] = {
        selected_answer_id: a.selected_answer_id,
        is_correct: a.is_correct,
      };
    });

    return {
      ...attempt,
      questions,
      answers: answerObj,
    };
  }

  async submit(data: SubmitQuizAttemptInput, ctx: RequestContext) {
    const supabase = await createClient();

    const { data: attempt, error: attemptCheckError } = await supabase
      .from('quiz_attempts')
      .select('*')
      .eq('id', data.attemptId)
      .eq('user_id', ctx.userId)
      .single();

    if (attemptCheckError || !attempt) throw new AppError('NOT_FOUND');
    if (attempt.completed_at) throw new AppError('BAD_REQUEST');

    let score = 0;
    const answerRecords = [];

    for (const ans of data.answers) {
      let isCorrect = false;
      if (ans.selectedAnswerId) {
        const { data: answer } = await supabase
          .from('question_answers')
          .select('is_correct')
          .eq('id', ans.selectedAnswerId)
          .single();
        isCorrect = answer?.is_correct ?? false;
      }
      if (isCorrect) score++;
      answerRecords.push({
        attempt_id: data.attemptId,
        question_id: ans.questionId,
        selected_answer_id: ans.selectedAnswerId ?? null,
        is_correct: isCorrect,
      });
    }

    const { error: updateError } = await supabase
      .from('quiz_attempts')
      .update({
        score,
        completed_at: new Date().toISOString(),
      })
      .eq('id', data.attemptId);

    if (updateError) throw mapSupabaseError(updateError);

    const { error: answersError } = await supabase.from('quiz_answers').insert(answerRecords);

    if (answersError) throw mapSupabaseError(answersError);

    return { score, totalQuestions: data.answers.length };
  }
}

export const quizAttemptService = new QuizAttemptService();
