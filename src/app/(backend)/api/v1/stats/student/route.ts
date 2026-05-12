import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { AppErrorCode, handleApiError } from '@/lib/errors';

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: AppErrorCode.UNAUTHORIZED }, { status: 401 });

    const { data: attempts } = await supabase
      .from('quiz_attempts')
      .select('score, total_questions, started_at, config')
      .eq('user_id', user.id)
      .order('started_at', { ascending: false });

    const { data: practice } = await supabase
      .from('flashcard_practice')
      .select('was_correct, practiced_at')
      .eq('user_id', user.id)
      .order('practiced_at', { ascending: false });

    const { data: questions } = await supabase
      .from('questions')
      .select('id')
      .eq('created_by', user.id);

    const totalQuizzes = attempts?.length ?? 0;
    const avgScore =
      attempts && attempts.length > 0
        ? Math.round(
            (attempts.reduce((sum, a) => sum + (a.score / Math.max(a.total_questions, 1)), 0) /
              attempts.length) *
              100,
          )
        : 0;

    const flashcardCorrect = practice?.filter((p) => p.was_correct).length ?? 0;
    const flashcardTotal = practice?.length ?? 0;

    return NextResponse.json({
      totalQuizzes,
      avgScore,
      totalQuestionsCreated: questions?.length ?? 0,
      flashcardsPracticed: flashcardTotal,
      flashcardAccuracy: flashcardTotal > 0 ? Math.round((flashcardCorrect / flashcardTotal) * 100) : 0,
      attemptsOverTime: attempts?.map((a) => ({
        date: a.started_at,
        score: a.score,
        total: a.total_questions,
        percentage: Math.round((a.score / Math.max(a.total_questions, 1)) * 100),
      })) ?? [],
    });
  } catch (error) {
    return handleApiError(error, AppErrorCode.INTERNAL_SERVER);
  }
}
