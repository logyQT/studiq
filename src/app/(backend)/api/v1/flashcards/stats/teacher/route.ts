import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { flashcardStatsController } from '@/server/controllers';

export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const query = Object.fromEntries(new URL(req.url).searchParams);
    return toNextResponse(await flashcardStatsController.getTeacherStats(query, ctx));
  });
}
