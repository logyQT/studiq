import { teacherAssignmentController } from '@studiq/server/controllers/teacher-assignment.controller';
import { authedRouteWithParams } from '@studiq/server/lib/route-handler';

type Params = { id: string };

/** Unpublishes one run; `assignment.update` gates in the controller. */
export const POST = authedRouteWithParams<Params, [string]>(
  ({ params: { id } }) => [id],
  (ctx, id) => teacherAssignmentController.unpublish(id, ctx),
);
