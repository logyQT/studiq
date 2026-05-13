import { createClient } from '@/lib/supabase/server';
import { AppError } from '@/lib/errors';
import type { SubmitQuizAttemptInput } from '@/server/models';

export class QuizAttemptService {
  async list(userId: string) {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('quiz_attempts')
      .select('*')
      .eq('user_id', userId)
      .order('started_at', { ascending: false });

    if (error) throw new AppError('INTERNAL_SERVER');
    return data;
  }

  async getById(attemptId: string, userId: string) {
    const supabase = await createClient();

    const { data: attempt, error: attemptError } = await supabase
      .from('quiz_attempts')
      .select('*')
      .eq('id', attemptId)
      .eq('user_id', userId)
      .single();

    if (attemptError || !attempt) throw new AppError('NOT_FOUND');

    const { data: attemptQuestions, error: questionsError } = await supabase
      .from('quiz_attempt_questions')
      .select('order_index, question_id, questions(*, question_answers(*))')
      .eq('attempt_id', attemptId)
      .order('order_index', { ascending: true });

    if (questionsError) throw new AppError('INTERNAL_SERVER');

    const { data: answers, error: answersError } = await supabase
      .from('quiz_answers')
      .select('*')
      .eq('attempt_id', attemptId);

    if (answersError) throw new AppError('INTERNAL_SERVER');

    const questions = (attemptQuestions ?? [])
      .sort((a, b) => a.order_index - b.order_index)
      .map((aq) => aq.questions);

    const answerObj: Record<string, { selected_answer_id: string | null; is_correct: boolean }> = {};
    (answers ?? []).forEach((a) => {
      answerObj[a.question_id] = { selected_answer_id: a.selected_answer_id, is_correct: a.is_correct };
    });

    return {
      ...attempt,
      questions,
      answers: answerObj,
    };
  }

  async submit(data: SubmitQuizAttemptInput, userId: string) {
    const supabase = await createClient();

    const { data: attempt, error: attemptCheckError } = await supabase
      .from('quiz_attempts')
      .select('*')
      .eq('id', data.attemptId)
      .eq('user_id', userId)
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

    if (updateError) throw new AppError('INTERNAL_SERVER');

    const { error: answersError } = await supabase
      .from('quiz_answers')
      .insert(answerRecords);

    if (answersError) throw new AppError('INTERNAL_SERVER');

    return { score, totalQuestions: data.answers.length };
  }
}

export const quizAttemptService = new QuizAttemptService();
