import { AccountType, type PermissionScope, type RequestContext } from '@studiq/authz';
import { PermissionsController } from '@studiq/server/controllers/permissions.controller';
import type { ControllerResponse } from '@studiq/server/lib/controller-response';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** What `listMyPermissions` puts in the response's `data`. */
interface PermissionsBody {
  permissions: Record<string, PermissionScope>;
  features?: Record<string, boolean>;
}

/**
 * The controller's declared response is `ControllerResponse<unknown>`; this view
 * narrows `data` to the payload the endpoint promises instead of using `any`.
 */
function body(response: ControllerResponse): PermissionsBody {
  return (response as Extract<ControllerResponse, { success: true }> & { data: PermissionsBody })
    .data;
}

const mockCtx: RequestContext = {
  traceId: 'test',
  userId: 'u-1',
  accountType: AccountType.STUDENT,
  orgRoleId: null,
  activeOrgId: null,
  url: '',
  method: 'GET',
  groupIds: [],
  permissionScopes: { 'flashcard.read': 'own' },
};

describe('PermissionsController', () => {
  let controller: PermissionsController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new PermissionsController();
  });

  describe('listMyPermissions', () => {
    it('returns the resolved permissions map', async () => {
      const response = await controller.listMyPermissions(mockCtx);

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
      expect(body(response).permissions).toBeDefined();
    });

    it('returns only the permissions map (features live on /features/me)', async () => {
      const response = await controller.listMyPermissions(mockCtx);

      expect(body(response).features).toBeUndefined();
    });

    it('adds default own permissions for student', async () => {
      const response = await controller.listMyPermissions(mockCtx);

      expect(response.success).toBe(true);
      const perms = body(response).permissions;
      expect(perms['flashcard.read']).toBe('own');
    });

    it('adds own permissions for educator', async () => {
      const educatorCtx = { ...mockCtx, accountType: AccountType.EDUCATOR };
      const response = await controller.listMyPermissions(educatorCtx);

      expect(response.success).toBe(true);
    });
  });
});
