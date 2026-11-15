import { AccountType } from '@studiq/authz';
import { teacherAssignmentController } from '@studiq/server/controllers/teacher-assignment.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return withAuth(
    req,
    async (ctx) => toNextResponse(await teacherAssignmentController.close(id, ctx)),
    // Closing ends attempts and reveals answers: the author or an org manager, never a student.
    { allowedAccountTypes: [AccountType.EDUCATOR, AccountType.MANAGER] },
  );
}
