import { AccountType, type RequestContext } from '@studiq/authz';
import { Permission } from '@studiq/server/lib/authz';
import type { ControllerResponse } from '@studiq/server/lib/controller-response';
import { wrapService } from '@studiq/server/lib/observability';

export class PermissionsController {
  // wrapService always exposes methods as Promise-returning; keep the async
  // contract even though this handler only reads from ctx.
  // eslint-disable-next-line @typescript-eslint/require-await -- no I/O to await
  async listMyPermissions(ctx: RequestContext): Promise<ControllerResponse> {
    const permissions = { ...ctx.permissionScopes };

    for (const perm of Object.values(Permission)) {
      if (!(perm in permissions)) {
        if (
          (ctx.accountType === AccountType.STUDENT || ctx.accountType === AccountType.EDUCATOR) &&
          (perm.endsWith('.read') ||
            perm.endsWith('.create') ||
            perm.endsWith('.update') ||
            perm.endsWith('.delete'))
        ) {
          permissions[perm] = 'own';
        }
      }
    }

    return { success: true, statusCode: 200, data: { permissions } };
  }
}
export const permissionsController = wrapService(
  new PermissionsController(),
  'permissions.controller',
);
