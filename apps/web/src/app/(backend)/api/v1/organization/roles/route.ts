import { orgRoleController } from '@studiq/server/controllers/org-role.controller';
import { authedRoute } from '@studiq/server/lib/route-handler';

/**
 * Readable by every member of the org (withAuth reads the caller's own role on
 * every request, and the member screens need the list). No persona and no
 * permission key: authority here is the active org membership.
 */
export const GET = authedRoute(
  () => [],
  (ctx) => orgRoleController.listRoles(ctx),
);

/** Writes are gated on `org.role.manage` in the controller (2a-2). */
export const POST = authedRoute(
  ({ json }) => [json],
  (ctx, body) => orgRoleController.createRole(ctx, body),
  { readsBody: true },
);
