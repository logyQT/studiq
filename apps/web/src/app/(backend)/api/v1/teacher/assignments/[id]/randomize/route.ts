import { teacherAssignmentController } from '@studiq/server/controllers/teacher-assignment.controller';
import { authedRouteWithParams } from '@studiq/server/lib/route-handler';

type Params = { id: string };

/** Randomizes one run's item order; `assignment.update` gates in the controller. */
export const POST = authedRouteWithParams<Params, [string, unknown]>(
  ({ params: { id }, json }) => [id, json],
  (ctx, id, body) => teacherAssignmentController.randomize(id, body, ctx),
  { readsBody: true },
);
