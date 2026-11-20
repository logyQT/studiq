import { teacherAssignmentController } from '@studiq/server/controllers/teacher-assignment.controller';
import { authedRouteWithParams } from '@studiq/server/lib/route-handler';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import { type NextRequest, NextResponse } from 'next/server';

/** Adds items to one run; `assignment.update` gates in the controller. */
export const POST = authedRouteWithParams<{ id: string }, [unknown, string]>(
  ({ params, json }) => [json, params.id],
  (ctx, body, id) => teacherAssignmentController.addQuestions(id, body, ctx),
  { readsBody: true },
);

/**
 * Removing an item carries its id in the query, not a body, and answers the missing-id
 * 422 itself — so this handler stays outside the wrapper (the way the logo route does)
 * instead of declaring a body a DELETE does not take. `assignment.update` still gates
 * inside the controller.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(req, async (ctx) => {
    const { id } = await params;
    const questionId = new URL(req.url).searchParams.get('questionId');
    if (!questionId) {
      return NextResponse.json({ success: false, error: 'MISSING_QUESTION_ID' }, { status: 422 });
    }
    return toNextResponse(await teacherAssignmentController.removeQuestion(id, questionId, ctx));
  });
}
