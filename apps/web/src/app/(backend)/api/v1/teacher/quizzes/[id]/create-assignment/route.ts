import { AccountType } from '@studiq/authz';
import { quizTeacherController } from '@studiq/server/controllers/quiz-teacher.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(
    req,
    async (ctx) => {
      const { id } = await params;
      return toNextResponse(await quizTeacherController.createAssignment(id, ctx));
    },
    { allowedAccountTypes: [AccountType.EDUCATOR] },
  );
}
