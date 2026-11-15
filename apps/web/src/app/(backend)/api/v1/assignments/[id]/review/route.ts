import { assessmentReviewController } from '@studiq/server/controllers/assessment-review.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  // `?attemptId=` reviews one submitted attempt; without it the latest one is reviewed. The
  // cohort-wide reveal also serves a student who has no attempt at all.
  const attemptId = req.nextUrl.searchParams.get('attemptId') ?? undefined;
  return withAuth(req, async (ctx) =>
    toNextResponse(await assessmentReviewController.review(id, attemptId, ctx)),
  );
}
