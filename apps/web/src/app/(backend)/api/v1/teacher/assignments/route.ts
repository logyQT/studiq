import { teacherAssignmentController } from '@studiq/server/controllers/teacher-assignment.controller';
import { authedRoute } from '@studiq/server/lib/route-handler';

/** The assignments `assignment.read` reaches; the key gates in the controller. */
export const GET = authedRoute(
  () => [],
  (ctx) => teacherAssignmentController.list(ctx),
);

/** Creates one in the active org; `assignment.create` gates in the controller. */
export const POST = authedRoute(
  ({ json }) => [json],
  (ctx, body) => teacherAssignmentController.create(body, ctx),
  { readsBody: true },
);
