import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { teacherAssignmentController } from '@/server/controllers/teacher-assignment.controller';

import { AccountType } from '@/types';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(
    req,
    async (ctx) => {
      const { id } = await params;
      const { searchParams } = new URL(req.url);
      const studentId = searchParams.get('studentId') ?? undefined;
      return toNextResponse(await teacherAssignmentController.exportAnswers(id, studentId, ctx));
    },
    { allowedAccountTypes: [AccountType.EDUCATOR, AccountType.MANAGER] },
  );
}
