import { authedRouteWithParams } from '@studiq/server/lib/route-handler';
import { groupController } from '@studiq/server/controllers/group.controller';

/**
 * The org members a class manager may still add to this class. The endpoint is
 * one read of one path id, so `read` names the awaited param and stops there.
 */
export const GET = authedRouteWithParams<{ id: string }, [string]>(
  ({ params }) => [params.id],
  (ctx, id) => groupController.listAddableMembers(ctx, id),
);
