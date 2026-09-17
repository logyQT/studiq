import { flashcardPracticeController } from '@studiq/server/controllers/flashcard-practice.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    return toNextResponse(await flashcardPracticeController.getStateBreakdown(ctx));
  });
}
