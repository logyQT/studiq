import { statsController } from '@studiq/server/controllers/stats.controller';
import { authedRoute } from '@studiq/server/lib/route-handler';

/** Teacher stats of the active org; `stats.read` gates in the controller. */
export const GET = authedRoute(
  () => [],
  (ctx) => statsController.getTeacherStats(Object.fromEntries(new URL(ctx.url).searchParams), ctx),
);
