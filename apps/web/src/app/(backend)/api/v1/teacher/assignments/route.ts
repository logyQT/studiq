import { AccountType } from '@studiq/authz';
import { teacherAssignmentController } from '@studiq/server/controllers/teacher-assignment.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  return withAuth(
    req,
    async (ctx) => {
      return toNextResponse(await teacherAssignmentController.list(ctx));
    },
    { allowedAccountTypes: [AccountType.EDUCATOR, AccountType.MANAGER] },
  );
}

export async function POST(req: NextRequest) {
  return withAuth(
    req,
    async (ctx) => {
      const body = await req.json();
      return toNextResponse(await teacherAssignmentController.create(body, ctx));
    },
    { allowedAccountTypes: [AccountType.EDUCATOR] },
  );
}
