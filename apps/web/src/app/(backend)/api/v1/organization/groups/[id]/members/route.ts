import { groupController } from '@studiq/server/controllers/group.controller';
import { authedRouteWithParams } from '@studiq/server/lib/route-handler';

/** Who is in the class, for anyone the service lets read it. */
export const GET = authedRouteWithParams<{ id: string }, [string]>(
  ({ params }) => [params.id],
  (ctx, id) => groupController.getGroupMembers(ctx, id),
);

/** Replaces it wholesale: the roster sent IS the roster afterwards. */
export const PUT = authedRouteWithParams<{ id: string }, [string, unknown]>(
  ({ params, json }) => [params.id, json],
  (ctx, id, body) => groupController.setGroupMembers(ctx, id, body),
  { readsBody: true },
);
