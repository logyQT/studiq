import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { quizAttemptController } from '@/server/controllers';

export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    return toNextResponse(await quizAttemptController.list(ctx));
  });
}
