import { AccountType } from '@studiq/authz';
import { teacherAssignmentController } from '@studiq/server/controllers/teacher-assignment.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; studentId: string }> },
) {
  return withAuth(
    req,
    async (ctx) => {
      const { id, studentId } = await params;
      return toNextResponse(
        await teacherAssignmentController.getStudentAnswers(id, studentId, ctx),
      );
    },
    { allowedAccountTypes: [AccountType.EDUCATOR, AccountType.MANAGER] },
  );
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; studentId: string }> },
) {
  return withAuth(
    req,
    async (ctx) => {
      const { id, studentId } = await params;
      const body = await req.json();
      return toNextResponse(
        await teacherAssignmentController.gradeAnswer(id, studentId, body, ctx),
      );
    },
    { allowedAccountTypes: [AccountType.EDUCATOR] },
  );
}
