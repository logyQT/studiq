import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { flashcardPracticeController } from '@/server/controllers';

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
