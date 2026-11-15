import { AccountType } from '@studiq/authz';
import { teacherAssignmentController } from '@studiq/server/controllers/teacher-assignment.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

/**
 * The two staff actions on one item's review visibility (R10): hold it back while the window is
 * live, and release it afterwards. They live together because they are one decision, and both are
 * staff-only.
 */
const STAFF = [AccountType.EDUCATOR, AccountType.MANAGER];

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; questionId: string }> },
) {
  return withAuth(
    req,
    async (ctx) => {
      const { id, questionId } = await params;
      const body: unknown = await req.json();
      return toNextResponse(
        await teacherAssignmentController.setReviewHold(id, questionId, body, ctx),
      );
    },
    { allowedAccountTypes: STAFF },
  );
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string; questionId: string }> },
) {
  const { id, questionId } = await context.params;
  return withAuth(
    req,
    async (ctx) =>
      toNextResponse(await teacherAssignmentController.releaseItem(id, questionId, ctx)),
    { allowedAccountTypes: STAFF },
  );
}
