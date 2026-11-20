import { groupController } from '@studiq/server/controllers/group.controller';
import { authedRouteWithParams } from '@studiq/server/lib/route-handler';

/** Renames or re-describes one class. */
export const PUT = authedRouteWithParams<{ id: string }, [string, unknown]>(
  ({ params, json }) => [params.id, json],
  (ctx, id, body) => groupController.updateGroup(ctx, id, body),
  { readsBody: true },
);

/** Deleting has no body: the id is the whole input. */
export const DELETE = authedRouteWithParams<{ id: string }, [string]>(
  ({ params }) => [params.id],
  (ctx, id) => groupController.deleteGroup(ctx, id),
);
