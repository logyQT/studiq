import { teacherAssignmentController } from '@studiq/server/controllers/teacher-assignment.controller';
import { authedRouteWithParams } from '@studiq/server/lib/route-handler';

type Params = { id: string };

/** Reads one run; `assignment.read` gates in the controller, resolved against the loaded row. */
export const GET = authedRouteWithParams<Params, [string]>(
  ({ params }) => [params.id],
  (ctx, id) => teacherAssignmentController.getById(id, ctx),
);

/** Edits one run; `assignment.update` gates in the controller. */
export const PUT = authedRouteWithParams<Params, [string, unknown]>(
  ({ params, json }) => [params.id, json],
  (ctx, id, body) => teacherAssignmentController.update(id, body, ctx),
  { readsBody: true },
);

/** Deleting has no body: the id is the whole input. `assignment.delete` gates in the controller. */
export const DELETE = authedRouteWithParams<Params, [string]>(
  ({ params }) => [params.id],
  (ctx, id) => teacherAssignmentController.delete(id, ctx),
);
