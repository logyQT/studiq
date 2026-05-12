import { createClient } from '@/lib/supabase/server';
import { AppError, AppErrorCode } from '@/lib/errors';
import type { GenerateQuizInput, SubmitQuizAttemptInput } from '@/server/models';

export class QuizService {
  async generateQuiz(config: GenerateQuizInput) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new AppError(AppErrorCode.UNAUTHORIZED, 401);

    let query = supabase
      .from('questions')
      .select('*, question_answers(*)')
      .in('type', config.questionTypes);

    if (config.subjectId) {
      query = query.eq('subject_id', config.subjectId);
    }

    if (config.difficulty && config.difficulty !== 'mixed') {
      query = query.eq('difficulty', config.difficulty);
    }

    const { data: allQuestions, error: fetchError } = await query;
    if (fetchError) throw new AppError(AppErrorCode.INTERNAL_SERVER, 500);
    if (!allQuestions || allQuestions.length === 0) {
      throw new AppError('No questions match your criteria', 404);
    }

    const shuffled = [...allQuestions].sort(() => Math.random() - 0.5);
    const selectedQuestions = shuffled.slice(0, Math.min(config.questionCount, shuffled.length));

    const { data: attempt, error: attemptError } = await supabase
      .from('quiz_attempts')
      .insert({
        user_id: user.id,
        score: 0,
        total_questions: selectedQuestions.length,
        config: config as unknown as Record<string, unknown>,
        completed_at: null,
      })
      .select()
      .single();

    if (attemptError || !attempt) throw new AppError(AppErrorCode.INTERNAL_SERVER, 500);

    const attemptQuestions = selectedQuestions.map((q, i) => ({
      attempt_id: attempt.id,
      question_id: q.id,
      order_index: i,
    }));

    const { error: questionsError } = await supabase
      .from('quiz_attempt_questions')
      .insert(attemptQuestions);

    if (questionsError) throw new AppError(AppErrorCode.INTERNAL_SERVER, 500);

    return {
      ...attempt,
      questions: selectedQuestions,
    };
  }

  async getAttemptById(attemptId: string) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new AppError(AppErrorCode.UNAUTHORIZED, 401);

    const { data: attempt, error: attemptError } = await supabase
      .from('quiz_attempts')
      .select('*')
      .eq('id', attemptId)
      .eq('user_id', user.id)
      .single();

    if (attemptError || !attempt) throw new AppError(AppErrorCode.NOT_FOUND, 404);

    const { data: attemptQuestions, error: questionsError } = await supabase
      .from('quiz_attempt_questions')
      .select('order_index, question_id, questions(*, question_answers(*))')
      .eq('attempt_id', attemptId)
      .order('order_index', { ascending: true });

    if (questionsError) throw new AppError(AppErrorCode.INTERNAL_SERVER, 500);

    const { data: answers, error: answersError } = await supabase
      .from('quiz_answers')
      .select('*')
      .eq('attempt_id', attemptId);

    if (answersError) throw new AppError(AppErrorCode.INTERNAL_SERVER, 500);

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

  async submitAttempt(data: SubmitQuizAttemptInput) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new AppError(AppErrorCode.UNAUTHORIZED, 401);

    const { data: attempt, error: attemptCheckError } = await supabase
      .from('quiz_attempts')
      .select('*')
      .eq('id', data.attemptId)
      .eq('user_id', user.id)
      .single();

    if (attemptCheckError || !attempt) throw new AppError(AppErrorCode.NOT_FOUND, 404);
    if (attempt.completed_at) throw new AppError('Attempt already submitted', 400);

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

    if (updateError) throw new AppError(AppErrorCode.INTERNAL_SERVER, 500);

    const { error: answersError } = await supabase
      .from('quiz_answers')
      .insert(answerRecords);

    if (answersError) throw new AppError(AppErrorCode.INTERNAL_SERVER, 500);

    return { score, totalQuestions: data.answers.length };
  }

  async getUserAttempts() {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new AppError(AppErrorCode.UNAUTHORIZED, 401);

    const { data, error } = await supabase
      .from('quiz_attempts')
      .select('*')
      .eq('user_id', user.id)
      .order('started_at', { ascending: false });

    if (error) throw new AppError(AppErrorCode.INTERNAL_SERVER, 500);
    return data;
  }

  async getAttemptDetails(attemptId: string) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new AppError(AppErrorCode.UNAUTHORIZED, 401);

    const { data: attempt, error: attemptError } = await supabase
      .from('quiz_attempts')
      .select('*')
      .eq('id', attemptId)
      .eq('user_id', user.id)
      .single();

    if (attemptError || !attempt) throw new AppError(AppErrorCode.NOT_FOUND, 404);

    const { data: attemptQuestions, error: questionsError } = await supabase
      .from('quiz_attempt_questions')
      .select('order_index, question_id, questions(*, question_answers(*))')
      .eq('attempt_id', attemptId)
      .order('order_index', { ascending: true });

    if (questionsError) throw new AppError(AppErrorCode.INTERNAL_SERVER, 500);

    const { data: answers, error: answersError } = await supabase
      .from('quiz_answers')
      .select('*')
      .eq('attempt_id', attemptId);

    if (answersError) throw new AppError(AppErrorCode.INTERNAL_SERVER, 500);

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
}

export const quizService = new QuizService();
