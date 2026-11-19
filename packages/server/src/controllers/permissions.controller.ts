import { type PermissionKey, type PermissionScope, type RequestContext } from '@studiq/authz';
import { Permission, resolveScope } from '@studiq/server/lib/authz';
import type { ControllerResponse } from '@studiq/server/lib/controller-response';
import { wrapService } from '@studiq/server/lib/observability';

export class PermissionsController {
  // wrapService always exposes methods as Promise-returning; keep the async
  // contract even though this handler only reads from ctx.
  // eslint-disable-next-line @typescript-eslint/require-await -- no I/O to await
  async listMyPermissions(ctx: RequestContext): Promise<ControllerResponse> {
    // The payload is the map `usePermission()` looks a key up in: absent means
    // deny, so every key `resolveScope` answers for is materialised here and
    // the server check and the UI gate cannot disagree about a permission.
    const permissions: Partial<Record<PermissionKey, PermissionScope>> = {};
    for (const permission of Object.values(Permission)) {
      const scope = resolveScope(ctx, permission);
      if (scope) permissions[permission] = scope;
    }

    return { success: true, statusCode: 200, data: { permissions } };
  }
}
export const permissionsController = wrapService(
  new PermissionsController(),
  'permissions.controller',
);
