import { AccountType } from '@studiq/authz';
import { teacherAssignmentController } from '@studiq/server/controllers/teacher-assignment.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

/**
 * The staff declarations on one bound item: hold its key back from the cohort review (R10) and
 * declare it taught (R9), plus the release that ends a hold. One path because they are one decision
 * surface; both are staff-only and both are refused once the run is closed.
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
        await teacherAssignmentController.setItemDeclarations(id, questionId, body, ctx),
      );
    },
    { allowedAccountTypes: STAFF },
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
    { allowedAccountTypes: STAFF },
  );
}
