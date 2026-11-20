import { groupController } from '@studiq/server/controllers/group.controller';
import { authedRouteWithParams } from '@studiq/server/lib/route-handler';

/** The org members a class manager may still add to this class. */
export const GET = authedRouteWithParams<{ id: string }, [string]>(
  ({ params }) => [params.id],
  (ctx, id) => groupController.listAddableMembers(ctx, id),
);
