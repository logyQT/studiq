import type { ControllerResponse } from '@/lib/controller-response';
import { getEnabledFeatures } from '@/lib/features';
import { getScope, Permission } from '@/lib/rbac';
import type { RequestContext } from '@/lib/request-context';

export class PermissionsController {
  async listMyPermissions(ctx: RequestContext): Promise<ControllerResponse> {
    const allPermissions = Object.values(Permission);
    const permissionChecks = await Promise.all(
      allPermissions.map(async (perm) => ({
        [perm]: await getScope(ctx.accountType, ctx.orgRoleId, perm),
      })),
    );
    const permissions = Object.assign({}, ...permissionChecks);
    const features = await getEnabledFeatures(ctx);
    return { success: true, statusCode: 200, data: { permissions, features } };
  }
}
