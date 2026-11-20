import { teacherAssignmentController } from '@studiq/server/controllers/teacher-assignment.controller';
import { authedRouteWithParams } from '@studiq/server/lib/route-handler';

/** Reorders one run's items; `assignment.update` gates in the controller. */
export const PUT = authedRouteWithParams<{ id: string }, [string, unknown]>(
  ({ params: { id }, json }) => [id, json],
  (ctx, id, body) => teacherAssignmentController.reorderQuestions(id, body, ctx),
  { readsBody: true },
);
