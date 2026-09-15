import { AccountType } from '@studiq/authz';
import { type NextRequest, NextResponse } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { teacherAssignmentController } from '@/server/controllers/teacher-assignment.controller';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(
    req,
    async (ctx) => {
      const { id } = await params;
      const body = await req.json();
      return toNextResponse(await teacherAssignmentController.addQuestions(id, body, ctx));
    },
    { allowedAccountTypes: [AccountType.EDUCATOR] },
  );
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(
    req,
    async (ctx) => {
      const { id } = await params;
      const { searchParams } = new URL(req.url);
      const questionId = searchParams.get('questionId');
      if (!questionId) {
        return NextResponse.json({ success: false, error: 'MISSING_QUESTION_ID' }, { status: 422 });
      }
      return toNextResponse(await teacherAssignmentController.removeQuestion(id, questionId, ctx));
    },
    { allowedAccountTypes: [AccountType.EDUCATOR] },
  );
}
