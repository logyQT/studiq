import { teacherAssignmentController } from '@studiq/server/controllers/teacher-assignment.controller';
import { authedRouteWithParams } from '@studiq/server/lib/route-handler';

type Params = { id: string };

/**
 * Closing ends attempts and reveals answers: the run's `assignment.update` key gates in
 * the controller, resolved against the loaded row (a foreign id is 404).
 */
export const POST = authedRouteWithParams<Params, [string]>(
  ({ params }) => [params.id],
  (ctx, id) => teacherAssignmentController.close(id, ctx),
);
