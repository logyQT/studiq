import { AccountType } from '@studiq/authz';
import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { quizTeacherController } from '@/server/controllers/quiz-teacher.controller';

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
