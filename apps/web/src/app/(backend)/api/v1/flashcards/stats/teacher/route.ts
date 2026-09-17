import { flashcardStatsController } from '@studiq/server/controllers/flashcard-stats.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const query = Object.fromEntries(new URL(req.url).searchParams);
    return toNextResponse(await flashcardStatsController.getTeacherStats(query, ctx));
  });
}
