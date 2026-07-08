import type { NextRequest } from 'next/server';
import { handleApiError, toNextResponse } from '@/lib/http-utils';
import type { RequestContext } from '@/lib/request-context';
import { createClient } from '@/lib/supabase/server';
import { withAuth } from '@/lib/with-auth';

export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx: RequestContext) => {
    try {
      const supabase = await createClient();

      const { data, error } = await supabase
        .from('quiz_attempts')
        .select('id, score, total_questions, started_at, completed_at, config')
        .not('completed_at', 'is', null);

      if (error) throw error;

      const quizMap = new Map<
        string,
        { totalAttempts: number; totalScore: number; totalCompletion: number }
      >();

      for (const row of data ?? []) {
        const config = row.config as { title?: string } | null;
        const title = config?.title ?? 'Untitled Quiz';

        if (!quizMap.has(title)) {
          quizMap.set(title, { totalAttempts: 0, totalScore: 0, totalCompletion: 0 });
        }

        const stats = quizMap.get(title)!;
        stats.totalAttempts += 1;
        stats.totalScore += row.score ?? 0;
        stats.totalCompletion += row.total_questions ?? 0;
      }

      const result = Array.from(quizMap.entries()).map(([title, stats]) => ({
        id: title,
        title,
        totalAttempts: stats.totalAttempts,
        avgScore: stats.totalScore / stats.totalAttempts,
        avgCompletionRate: stats.totalCompletion / stats.totalAttempts,
      }));

      return toNextResponse({ success: true, statusCode: 200, data: result });
    } catch (error) {
      return handleApiError(error, 'INTERNAL_SERVER', ctx);
    }
  });
}
