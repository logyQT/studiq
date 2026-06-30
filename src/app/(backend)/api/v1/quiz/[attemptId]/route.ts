import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { quizAttemptController } from '@/server/controllers';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ attemptId: string }> },
) {
  return withAuth(req, async (ctx) => {
    const { attemptId } = await params;
    return toNextResponse(await quizAttemptController.getDetails(attemptId, ctx));
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ attemptId: string }> },
) {
  return withAuth(req, async (ctx) => {
    const { attemptId } = await params;
    const body = await req.json();
    return toNextResponse(await quizAttemptController.submit(body, attemptId, ctx));
  });
}
