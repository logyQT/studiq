import { activityController } from '@studiq/server/controllers/activity.controller';
import { authedRoute } from '@studiq/server/lib/route-handler';

/** Class activity of the active org; `stats.read` gates in the controller. */
export const GET = authedRoute(
  () => [],
  (ctx) => activityController.getActivity(ctx, Object.fromEntries(new URL(ctx.url).searchParams)),
);
