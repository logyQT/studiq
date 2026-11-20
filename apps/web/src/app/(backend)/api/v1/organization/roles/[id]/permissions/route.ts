import { orgRoleController } from '@studiq/server/controllers/org-role.controller';
import { authedRouteWithParams } from '@studiq/server/lib/route-handler';

type Params = { id: string };

/** Replaces one role's permission set; `org.role.manage` is the controller's gate. */
export const PUT = authedRouteWithParams<Params, [string, unknown]>(
  ({ params: { id }, json }) => [id, json],
  (ctx, id, body) => orgRoleController.setPermissions(ctx, id, body),
  { readsBody: true },
);
