import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { quizTeacherController } from '@/server/controllers';
import { AccountType } from '@/types';

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
