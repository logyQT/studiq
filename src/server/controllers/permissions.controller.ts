import type { ControllerResponse } from '@/lib/controller-response';
import { getPermissionsForRole } from '@/lib/rbac';
import type { RequestContext } from '@/lib/request-context';
import { withErrorHandling } from '@/lib/with-error-handling';

export class PermissionsController {
  async listMyPermissions(ctx: RequestContext): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const permissions = await getPermissionsForRole(ctx.role);
      return { success: true, statusCode: 200, data: { permissions } };
    }, ctx);
  }
}

export const permissionsController = new PermissionsController();
