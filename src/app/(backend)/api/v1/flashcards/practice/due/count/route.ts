import { flashcardPracticeController } from '@studiq/server/controllers/flashcard-practice.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const { searchParams } = new URL(req.url);
    const topicIds = searchParams.get('topicIds')?.split(',').filter(Boolean);
    const deckIds = searchParams.get('deckIds')?.split(',').filter(Boolean);

    return toNextResponse(
      await flashcardPracticeController.getDueCount(ctx, { topicIds, deckIds }),
    );
  });
}
