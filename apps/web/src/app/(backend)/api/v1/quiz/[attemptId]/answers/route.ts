import { quizAttemptController } from '@studiq/server/controllers/quiz-attempt.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ attemptId: string }> },
) {
  return withAuth(req, async (ctx) => {
    const { attemptId } = await params;
    const body = await req.json();
    return toNextResponse(await quizAttemptController.saveAnswers(body, attemptId, ctx));
  });
}
