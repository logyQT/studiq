import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/with-auth';
import { createClient } from '@/lib/supabase/server';
import { toNextResponse } from '@/lib/http-utils';
import { withErrorHandling } from '@/lib/with-error-handling';
import type { RequestContext } from '@/lib/request-context';

async function handler(ctx: RequestContext) {
  return withErrorHandling(async () => {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('quiz_attempts')
      .select('id, score, total_questions, started_at, completed_at, config')
      .not('completed_at', 'is', null);

    if (error) {
      return { success: true, statusCode: 200, data: [] as unknown[] };
    }

    type QuizRow = { score: number; total_questions: number; config: Record<string, unknown> | null };
    const rows = (data || []) as unknown as QuizRow[];

    const quizMap = new Map<string, { totalScore: number; totalAttempts: number; totalCompletion: number }>();

    for (const row of rows) {
      const title = (row.config && typeof row.config === 'object' ? (row.config as Record<string, unknown>)?.title : undefined) as string | undefined;
      const quizTitle = title || 'Untitled Quiz';
      const entry = quizMap.get(quizTitle) || { totalScore: 0, totalAttempts: 0, totalCompletion: 0 };
      entry.totalScore += row.score;
      entry.totalAttempts += 1;
      entry.totalCompletion += row.total_questions > 0 ? (row.score / row.total_questions) * 100 : 0;
      quizMap.set(quizTitle, entry);
    }

    const result = Array.from(quizMap.entries()).map(([title, stats]) => ({
      id: title,
      title,
      totalAttempts: stats.totalAttempts,
      avgScore: stats.totalScore / stats.totalAttempts,
      avgCompletionRate: stats.totalCompletion / stats.totalAttempts,
    }));

    return { success: true, statusCode: 200, data: result };
  }, ctx);
}

export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    return toNextResponse(await handler(ctx));
  });
}
