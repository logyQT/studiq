import { teacherAssignmentController } from '@studiq/server/controllers/teacher-assignment.controller';
import { authedRouteWithParams } from '@studiq/server/lib/route-handler';

type Params = { id: string };

/** Replaces one run's cohort; `assignment.update` gates in the controller. */
export const PUT = authedRouteWithParams<Params, [Params, unknown]>(
  ({ params, json }) => [params, json],
  (ctx, params, body) => teacherAssignmentController.setTargets(params.id, body, ctx),
  { readsBody: true },
);
