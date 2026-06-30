import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { flashcardPracticeController } from '@/server/controllers';

export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const { searchParams } = new URL(req.url);
    const filters: Record<string, unknown> = {};

    const deckIds = searchParams.get('deckIds');
    if (deckIds) filters.deckIds = deckIds.split(',');

    const topicIds = searchParams.get('topicIds');
    if (topicIds) filters.topicIds = topicIds.split(',');

    const state = searchParams.get('state');
    if (state) filters.state = state;

    const sortBy = searchParams.get('sortBy');
    if (sortBy) filters.sortBy = sortBy;

    const order = searchParams.get('order');
    if (order) filters.order = order;

    const limit = searchParams.get('limit');
    if (limit) filters.limit = parseInt(limit, 10);

    const cursor = searchParams.get('cursor');
    if (cursor) filters.cursor = cursor;

    return toNextResponse(await flashcardPracticeController.getAllCardStats(ctx, filters));
  });
}
