import { flashcardStatsController } from '@studiq/server/controllers/flashcard-stats.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ bucket: string }> }) {
  return withAuth(_req, async (ctx) => {
    const { bucket } = await params;
    return toNextResponse(await flashcardStatsController.getDifficultyCards({ bucket }, ctx));
  });
}
