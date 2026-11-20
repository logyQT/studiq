import { statsController } from '@studiq/server/controllers/stats.controller';
import { authedRoute } from '@studiq/server/lib/route-handler';

/** Per-quiz aggregates of the org's students; `stats.read` gates in the controller. */
export const GET = authedRoute(
  () => [],
  (ctx) => statsController.getTeacherQuizStats(ctx),
);
