import type { RequestContext } from '@studiq/authz';
import { organizationController } from '@studiq/server/controllers/organization.controller';
import { AppError } from '@studiq/server/lib/errors';
import { authedRouteWithParams } from '@studiq/server/lib/route-handler';

type Params = { id: string };

/**
 * `with-auth.ts` only sets `ctx.activeOrgId` (and `ctx.orgRoleId`) when a real
 * `org_members` row exists for this exact org+user, so a forged `active_org_id`
 * cookie cannot reach here. Both comparisons stay as defence in depth.
 */
function requireActiveOrg(ctx: RequestContext, id: string): void {
  if (id !== ctx.activeOrgId || !ctx.orgRoleId) throw new AppError('FORBIDDEN');
}

/** The org row every member of the active org may read (ADR-0015 §7). */
export const GET = authedRouteWithParams<Params, [string]>(
  ({ params }) => [params.id],
  (ctx, id) => {
    requireActiveOrg(ctx, id);
    return organizationController.getById(id);
  },
);

/** Settings are `org.settings.manage`; the controller owns the key. */
export const PUT = authedRouteWithParams<Params, [string, unknown]>(
  ({ params, json }) => [params.id, json],
  (ctx, id, body) => {
    requireActiveOrg(ctx, id);
    return organizationController.update(ctx, id, body);
  },
  { readsBody: true },
);
