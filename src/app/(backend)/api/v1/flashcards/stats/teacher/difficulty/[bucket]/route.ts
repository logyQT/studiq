import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { flashcardStatsController } from '@/server/controllers';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ bucket: string }> }) {
  return withAuth(_req, async (ctx) => {
    const { bucket } = await params;
    return toNextResponse(await flashcardStatsController.getDifficultyCards({ bucket }, ctx));
  });
}
