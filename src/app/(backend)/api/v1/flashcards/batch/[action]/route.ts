import type { RequestContext } from '@studiq/authz';
import { flashcardController } from '@studiq/server/controllers/flashcard.controller';
import { flashcardPracticeController } from '@studiq/server/controllers/flashcard-practice.controller';
import type { ControllerResponse } from '@studiq/server/lib/controller-response';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

type ActionHandler = (body: unknown, ctx: RequestContext) => Promise<ControllerResponse>;

const actionHandlers: Record<string, ActionHandler> = {
  link: (body, ctx) => flashcardController.batchLink(body, ctx),
  copy: (body, ctx) => flashcardController.batchCopy(body, ctx),
  delete: (body, ctx) => flashcardController.batchDelete(body, ctx),
  topics: (body, ctx) => flashcardController.batchTopics(body, ctx),
  unlink: (body, ctx) => flashcardController.batchUnlink(body, ctx),
  move: (body, ctx) => flashcardController.batchMove(body, ctx),
  practice: (body, ctx) => flashcardPracticeController.batch(body, ctx),
  create: (body, ctx) => flashcardController.bulkCreate(body, ctx),
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
