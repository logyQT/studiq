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
      const body = await req.json();
      return toNextResponse(await quizTeacherController.addQuestions(id, body, ctx));
    },
    { allowedAccountTypes: [AccountType.EDUCATOR] },
  );
}
