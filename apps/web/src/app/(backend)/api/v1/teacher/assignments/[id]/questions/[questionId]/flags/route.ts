import { teacherAssignmentController } from '@studiq/server/controllers/teacher-assignment.controller';
import { itemFlagRoute } from '@studiq/server/lib/item-flag-route';
import { authedRouteWithParams } from '@studiq/server/lib/route-handler';

type Params = { id: string; questionId: string };

/**
 * The staff declarations on one bound item: hold its key back from the cohort review (R10) and
 * declare it taught (R9), plus the release that ends a hold. One path because they are one
 * decision surface; the hold is decided while the window is live, the declaration only on a
 * draft, and each verb's service call enforces its own state. `assignment.update` gates in
 * the controller.
 */
export const PUT = itemFlagRoute((id, questionId, body, ctx) =>
  teacherAssignmentController.setReviewHold(id, questionId, body, ctx),
);

/** R9: the teacher's declaration that one assessment item was taught before the window opened. */
export const PATCH = itemFlagRoute((id, questionId, body, ctx) =>
  teacherAssignmentController.setTaughtItem(id, questionId, body, ctx),
);

/** Releases a held item; `assignment.update` gates in the controller. */
export const POST = authedRouteWithParams<Params, [string, string]>(
  ({ params: { id, questionId } }) => [id, questionId],
  (ctx, id, questionId) => teacherAssignmentController.releaseItem(id, questionId, ctx),
);
