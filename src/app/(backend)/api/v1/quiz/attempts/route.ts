import { quizAttemptController } from '@studiq/server/controllers/quiz-attempt.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    return toNextResponse(await quizAttemptController.list(ctx));
  });
}
