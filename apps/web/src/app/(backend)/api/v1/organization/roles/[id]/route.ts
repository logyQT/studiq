import { orgRoleController } from '@studiq/server/controllers/org-role.controller';
import { authedRouteWithParams } from '@studiq/server/lib/route-handler';

type Params = { id: string };

/** Readable by every member of the org; writes gate on `org.role.manage`. */
export const GET = authedRouteWithParams<Params, [string]>(
  ({ params }) => [params.id],
  (ctx, id) => orgRoleController.getRole(ctx, id),
);

export const PUT = authedRouteWithParams<Params, [string, unknown]>(
  ({ params, json }) => [params.id, json],
  (ctx, id, body) => orgRoleController.updateRole(ctx, id, body),
  { readsBody: true },
);

export const DELETE = authedRouteWithParams<Params, [string]>(
  ({ params }) => [params.id],
  (ctx, id) => orgRoleController.deleteRole(ctx, id),
);
