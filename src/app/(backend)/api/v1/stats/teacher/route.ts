import { NextRequest, NextResponse } from 'next/server';
import { questionService } from '@/server/services';
import { createClient } from '@/lib/supabase/server';
import { AppErrorCode, handleApiError } from '@/lib/errors';

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: AppErrorCode.UNAUTHORIZED }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const subjectId = searchParams.get('subjectId') || undefined;

    const { data: questions } = await supabase
      .from('questions')
      .select('id')
      .eq('created_by', user.id);

    const { data: flashcards } = await supabase
      .from('flashcards')
      .select('id')
      .eq('created_by', user.id);

    const stats = {
      totalQuestions: questions?.length ?? 0,
      totalFlashcards: flashcards?.length ?? 0,
    };

    if (subjectId) {
      const questionStats = await questionService.getStatsBySubject(subjectId);
      return NextResponse.json({ ...stats, subject: questionStats });
    }

    return NextResponse.json(stats);
  } catch (error) {
    return handleApiError(error, AppErrorCode.INTERNAL_SERVER);
  }
}
