import { AccountType, type RequestContext } from '@studiq/authz';
import { Permission } from '@studiq/server/lib/authz';
import type { ControllerResponse } from '@studiq/server/lib/controller-response';
import { wrapService } from '@studiq/server/lib/observability';

export class PermissionsController {
  listMyPermissions(ctx: RequestContext): ControllerResponse {
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
