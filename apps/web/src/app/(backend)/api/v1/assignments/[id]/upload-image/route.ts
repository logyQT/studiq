import { teacherAssignmentController } from '@studiq/server/controllers/teacher-assignment.controller';
import { handleApiError, toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import { storageService } from '@studiq/server/services/storage.service';
import { type NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(req, async (ctx) => {
    const { id } = await params;

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch (error) {
      // Malformed or truncated multipart body — a client error, not a 500 (#185).
      return handleApiError(error, 'BAD_REQUEST');
    }

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
    } catch (error) {
      // Surface validation failures (422) and oversize uploads (413) instead of
      // collapsing every one of them into a 500.
      return handleApiError(error);
    }
  });
}
