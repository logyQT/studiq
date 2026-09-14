import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { flashcardController } from '@/server/controllers';

export async function POST(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const body = await req.json();
    return toNextResponse(await flashcardController.create(body, ctx));
  });
}

export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const { searchParams } = new URL(req.url);
    const topicIds = searchParams.get('topicIds')?.split(',').filter(Boolean);
    const deckIds = searchParams.get('deckIds')?.split(',').filter(Boolean);
    const q = searchParams.get('q') ?? undefined;
    const sortBy = searchParams.get('sortBy') ?? undefined;
    const sortOrder = searchParams.get('sortOrder') ?? undefined;
    const cursor = searchParams.get('cursor') ?? undefined;
    const limit = searchParams.get('limit') ? Number(searchParams.get('limit')) : undefined;
    const filters: {
      topicIds?: string[];
      deckIds?: string[];
      q?: string;
      sortBy?: string;
      sortOrder?: string;
      cursor?: string;
      limit?: number;
    } = {};
    if (topicIds && topicIds.length > 0) filters.topicIds = topicIds;
    if (deckIds && deckIds.length > 0) filters.deckIds = deckIds;
    if (q) filters.q = q;
    if (sortBy) filters.sortBy = sortBy;
    if (sortOrder) filters.sortOrder = sortOrder;
    if (cursor) filters.cursor = cursor;
    if (limit) filters.limit = limit;

    return toNextResponse(
      await flashcardController.list(ctx, Object.keys(filters).length > 0 ? filters : undefined),
    );
  });
}
