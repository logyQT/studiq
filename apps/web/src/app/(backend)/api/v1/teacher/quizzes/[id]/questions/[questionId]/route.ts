import { AccountType } from '@studiq/authz';
import { quizTeacherController } from '@studiq/server/controllers/quiz-teacher.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; questionId: string }> },
) {
  return withAuth(
    req,
    async (ctx) => {
      const { id, questionId } = await params;
      return toNextResponse(await quizTeacherController.removeQuestion(id, questionId, ctx));
    },
    { allowedAccountTypes: [AccountType.EDUCATOR] },
  );
}
