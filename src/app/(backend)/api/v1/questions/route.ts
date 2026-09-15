import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { questionController } from '@/server/controllers/question.controller';

export async function POST(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const body = await req.json();
    return toNextResponse(await questionController.create(body, ctx));
  });
}

export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const { searchParams } = new URL(req.url);

    const bankId = searchParams.get('bankId') || undefined;
    const topicIds = searchParams.get('topicIds') || undefined;
    const type = searchParams.get('type') || undefined;
    const filters: Record<string, string> = {};
    if (bankId) filters.bankId = bankId;
    if (topicIds) filters.topicIds = topicIds;
    if (type) filters.type = type;

    return toNextResponse(
      await questionController.list(ctx, Object.keys(filters).length > 0 ? filters : undefined),
    );
  });
}
