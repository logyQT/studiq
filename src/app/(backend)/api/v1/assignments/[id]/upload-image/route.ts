import { teacherAssignmentController } from '@studiq/server/controllers/teacher-assignment.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import { storageService } from '@studiq/server/services/storage.service';
import { type NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(req, async (ctx) => {
    const { id } = await params;
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const attemptId = formData.get('attemptId') as string | null;
    const questionId = formData.get('questionId') as string | null;

    if (!file || !attemptId || !questionId) {
      return NextResponse.json({ success: false, error: 'MISSING_FIELDS' }, { status: 422 });
    }

    try {
      const { url } = await storageService.uploadToBucket(
        ctx.userId,
        file,
        'assignment-images',
        `${ctx.activeOrgId ?? ctx.userId}/${id}/${attemptId}`,
      );
      return toNextResponse(
        await teacherAssignmentController.uploadImage(id, attemptId, questionId, url, ctx),
      );
    } catch {
      return NextResponse.json({ success: false, error: 'INTERNAL_SERVER' }, { status: 500 });
    }
  });
}
