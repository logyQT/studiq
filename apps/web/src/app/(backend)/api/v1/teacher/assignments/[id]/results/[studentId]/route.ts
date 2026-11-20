import { teacherAssignmentController } from '@studiq/server/controllers/teacher-assignment.controller';
import { authedRouteWithParams } from '@studiq/server/lib/route-handler';

type Params = { id: string; studentId: string };

/** One student's answers in a run; the parent's key gates in the controller as the service decides. */
export const GET = authedRouteWithParams<Params, [string, string]>(
  ({ params }) => [params.id, params.studentId],
  (ctx, id, studentId) => teacherAssignmentController.getStudentAnswers(id, studentId, ctx),
);

/** Grades one student's answer; `assignment.update` gates in the controller. */
export const PUT = authedRouteWithParams<Params, [string, string, unknown]>(
  ({ params, json }) => [params.id, params.studentId, json],
  (ctx, id, studentId, body) => teacherAssignmentController.gradeAnswer(id, studentId, body, ctx),
  { readsBody: true },
);
