import { teacherAssignmentController } from '@studiq/server/controllers/teacher-assignment.controller';
import { authedRouteWithParams } from '@studiq/server/lib/route-handler';

type Params = { id: string };

/** Publishes one run to its cohort; `assignment.update` gates in the controller. */
export const POST = authedRouteWithParams<Params, [string, unknown]>(
  ({ params, json }) => [params.id, json],
  (ctx, id, body) => teacherAssignmentController.publish(id, body, ctx),
  { readsBody: true },
);
