import type { RequestContext } from '@studiq/authz';
import { Permission } from '@studiq/server/lib/authz';
import type { ControllerResponse } from '@studiq/server/lib/controller-response';
import { wrapService } from '@studiq/server/lib/observability';

export class PermissionsController {
  async listMyPermissions(ctx: RequestContext): Promise<ControllerResponse> {
    const permissions = { ...ctx.permissionScopes };

    for (const key of Object.keys(Permission)) {
      const perm = Permission[key as keyof typeof Permission];
      if (!(perm in permissions)) {
        if (
          (ctx.accountType === 'student' || ctx.accountType === 'educator') &&
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
