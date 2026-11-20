import { groupController } from '@studiq/server/controllers/group.controller';
import { authedRoute } from '@studiq/server/lib/route-handler';

/** The classes of the active org, as `group.read` reaches them. */
export const GET = authedRoute(
  () => [],
  (ctx) => groupController.listGroups(ctx),
);

/** Creates one: a new class has no row yet, so the check is the key, not a group. */
export const POST = authedRoute(
  ({ json }) => [json],
  (ctx, body) => groupController.createGroup(ctx, body),
  { readsBody: true },
);
