import { AccountType } from '@studiq/authz';
import { teacherAssignmentController } from '@studiq/server/controllers/teacher-assignment.controller';
import { itemFlagRoute } from '@studiq/server/lib/item-flag-route';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

/**
 * The staff declarations on one bound item: hold its key back from the cohort review (R10) and
 * declare it taught (R9), plus the release that ends a hold. One path because they are one decision
 * surface; both are staff-only. The hold is decided while the window is live, the declaration only
 * on a draft, and each verb's service call enforces its own state.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; questionId: string }> },
) {
  return itemFlagRoute(req, params, (id, questionId, body, ctx) =>
    teacherAssignmentController.setReviewHold(id, questionId, body, ctx),
  );
}

/** R9: the teacher's declaration that one assessment item was taught before the window opened. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; questionId: string }> },
) {
  return itemFlagRoute(req, params, (id, questionId, body, ctx) =>
    teacherAssignmentController.setTaughtItem(id, questionId, body, ctx),
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; questionId: string }> },
) {
  const { id, questionId } = await params;
  return withAuth(
    req,
    async (ctx) =>
      toNextResponse(await teacherAssignmentController.releaseItem(id, questionId, ctx)),
    { allowedAccountTypes: [AccountType.EDUCATOR, AccountType.MANAGER] },
  );
}
