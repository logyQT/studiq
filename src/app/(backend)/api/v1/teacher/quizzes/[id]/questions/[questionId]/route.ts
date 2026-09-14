import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { quizTeacherController } from '@/server/controllers';
import { AccountType } from '@/types';

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
