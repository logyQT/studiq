import { AccountType } from '@studiq/authz';
import { quizTeacherController } from '@studiq/server/controllers/quiz-teacher.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  return withAuth(
    req,
    async (ctx) => {
      return toNextResponse(await quizTeacherController.list(ctx));
    },
    { allowedAccountTypes: [AccountType.EDUCATOR, AccountType.MANAGER] },
  );
}

export async function POST(req: NextRequest) {
  return withAuth(
    req,
    async (ctx) => {
      const body = await req.json();
      return toNextResponse(await quizTeacherController.create(body, ctx));
    },
    { allowedAccountTypes: [AccountType.EDUCATOR] },
  );
}
