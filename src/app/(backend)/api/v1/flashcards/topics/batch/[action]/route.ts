import type { NextRequest } from 'next/server';
import type { ControllerResponse } from '@/lib/controller-response';
import { toNextResponse } from '@/lib/http-utils';
import type { RequestContext } from '@/lib/request-context';
import { withAuth } from '@/lib/with-auth';
import { flashcardTopicController } from '@/server/controllers';

type ActionHandler = (body: unknown, ctx: RequestContext) => Promise<ControllerResponse>;

const actionHandlers: Record<string, ActionHandler> = {
  delete: (body, ctx) => flashcardTopicController.batchDelete(body, ctx),
  create: (body, ctx) => flashcardTopicController.bulkCreate(body, ctx),
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  return withAuth(req, async (ctx) => {
    const { action } = await params;
    const handler = actionHandlers[action];
    if (!handler) {
      return toNextResponse({
        success: false as const,
        statusCode: 400,
        error: 'BAD_REQUEST' as const,
      });
    }
    const body = await req.json();
    return toNextResponse(await handler(body, ctx));
  });
}
