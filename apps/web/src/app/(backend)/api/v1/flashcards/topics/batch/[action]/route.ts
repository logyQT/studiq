import type { RequestContext } from '@studiq/authz';
import { topicController } from '@studiq/server/controllers/topic.controller';
import type { ControllerResponse } from '@studiq/server/lib/controller-response';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

type ActionHandler = (body: unknown, ctx: RequestContext) => Promise<ControllerResponse>;

const actionHandlers: Record<string, ActionHandler> = {
  delete: (body, ctx) => topicController.batchDelete(body, ctx),
  create: (body, ctx) => topicController.bulkCreate(body, ctx),
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
