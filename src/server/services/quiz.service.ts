import { createClient } from '@/lib/supabase/server';
import { AppError } from '@/lib/errors';
import type { GenerateQuizInput } from '@/server/models';

export class QuizService {
  async generateQuiz(config: GenerateQuizInput, userId: string) {
    const supabase = await createClient();

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
    if (fetchError) throw new AppError('INTERNAL_SERVER');
    if (!allQuestions || allQuestions.length === 0) {
      throw new AppError('NOT_FOUND');
    }

    const shuffled = [...allQuestions].sort(() => Math.random() - 0.5);
    const selectedQuestions = shuffled.slice(0, Math.min(config.questionCount, shuffled.length));

    const { data: attempt, error: attemptError } = await supabase
      .from('quiz_attempts')
      .insert({
        user_id: userId,
        score: 0,
        total_questions: selectedQuestions.length,
        config: config as unknown as Record<string, unknown>,
        completed_at: null,
      })
      .select()
      .single();

    if (attemptError || !attempt) throw new AppError('INTERNAL_SERVER');

    const attemptQuestions = selectedQuestions.map((q, i) => ({
      attempt_id: attempt.id,
      question_id: q.id,
      order_index: i,
    }));

    const { error: questionsError } = await supabase
      .from('quiz_attempt_questions')
      .insert(attemptQuestions);

    if (questionsError) throw new AppError('INTERNAL_SERVER');

    return {
      ...attempt,
      questions: selectedQuestions,
    };
  }
}

export const quizService = new QuizService();
