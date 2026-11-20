import { statsController } from '@studiq/server/controllers/stats.controller';
import { authedRoute } from '@studiq/server/lib/route-handler';

/** Per-class performance of the caller's classes; `stats.read` gates in the controller. */
export const GET = authedRoute(
  () => [],
  (ctx) =>
    statsController.getTeacherGroupPerformance(
      Object.fromEntries(new URL(ctx.url).searchParams),
      ctx,
    ),
);
