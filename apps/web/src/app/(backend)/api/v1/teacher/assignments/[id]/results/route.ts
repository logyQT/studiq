import { teacherAssignmentController } from '@studiq/server/controllers/teacher-assignment.controller';
import { authedRouteWithParams } from '@studiq/server/lib/route-handler';

type Params = { id: string };

/** The cohort results of one run; the parent's key gates in the controller as the service decides. */
export const GET = authedRouteWithParams<Params, [string]>(
  ({ params: { id } }) => [id],
  (ctx, id) => teacherAssignmentController.getResults(id, ctx),
);
