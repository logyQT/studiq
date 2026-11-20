import { statsController } from '@studiq/server/controllers/stats.controller';
import { authedRoute } from '@studiq/server/lib/route-handler';

/** The recent activity feed of the caller's classes; `stats.read` gates in the controller. */
export const GET = authedRoute(
  () => [],
  (ctx) =>
    statsController.getTeacherActivityFeed(Object.fromEntries(new URL(ctx.url).searchParams), ctx),
);
