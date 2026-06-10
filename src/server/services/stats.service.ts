import { createClient } from '@/lib/supabase/server';
import { questionService } from '@/server/services';
import { mapSupabaseError } from '@/lib/supabase-errors';
import type { RequestContext } from '@/lib/request-context';

export class StatsService {
  async getTeacherStats(ctx: RequestContext, subjectId?: string) {
    const supabase = await createClient();

    const { data: questions, error: questionsError } = await supabase
      .from('questions')
      .select('id')
      .eq('created_by', ctx.userId);

    if (questionsError) throw mapSupabaseError(questionsError);

    const { data: flashcards, error: flashcardsError } = await supabase
      .from('flashcards')
      .select('id')
      .eq('created_by', ctx.userId);

    if (flashcardsError) throw mapSupabaseError(flashcardsError);

    const stats = {
      totalQuestions: questions?.length ?? 0,
      totalFlashcards: flashcards?.length ?? 0,
    };

    if (subjectId) {
      const questionStats = await questionService.getStatsBySubject(subjectId);
      return { ...stats, subject: questionStats };
    }

    return stats;
  }

  async getStudentStats(ctx: RequestContext) {
    const supabase = await createClient();

    const { data: attempts, error: attemptsError } = await supabase
      .from('quiz_attempts')
      .select('score, total_questions, started_at, config')
      .eq('user_id', ctx.userId)
      .order('started_at', { ascending: false });

    if (attemptsError) throw mapSupabaseError(attemptsError);

    const { data: practice, error: practiceError } = await supabase
      .from('flashcard_practice')
      .select('was_correct, practiced_at')
      .eq('user_id', ctx.userId)
      .order('practiced_at', { ascending: false });

    if (practiceError) throw mapSupabaseError(practiceError);

    const { data: questions, error: questionsError } = await supabase
      .from('questions')
      .select('id')
      .eq('created_by', ctx.userId);

    if (questionsError) throw mapSupabaseError(questionsError);

    const totalQuizzes = attempts?.length ?? 0;
    const avgScore =
      attempts && attempts.length > 0
        ? Math.round(
            (attempts.reduce((sum, a) => sum + a.score / Math.max(a.total_questions, 1), 0) /
              attempts.length) *
              100,
          )
        : 0;

    const flashcardCorrect = practice?.filter((p) => p.was_correct).length ?? 0;
    const flashcardTotal = practice?.length ?? 0;

    return {
      totalQuizzes,
      avgScore,
      totalQuestionsCreated: questions?.length ?? 0,
      flashcardsPracticed: flashcardTotal,
      flashcardAccuracy:
        flashcardTotal > 0 ? Math.round((flashcardCorrect / flashcardTotal) * 100) : 0,
      attemptsOverTime:
        attempts?.map((a) => ({
          date: a.started_at,
          score: a.score,
          total: a.total_questions,
          percentage: Math.round((a.score / Math.max(a.total_questions, 1)) * 100),
        })) ?? [],
    };
  }
}

export const statsService = new StatsService();
