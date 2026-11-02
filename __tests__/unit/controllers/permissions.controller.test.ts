import { AccountType, type PermissionScope, type RequestContext } from '@studiq/authz';
import { PermissionsController } from '@studiq/server/controllers/permissions.controller';
import type { ControllerResponse } from '@studiq/server/lib/controller-response';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** What `listMyPermissions` puts in the response's `data`. */
interface PermissionsBody {
  permissions: Record<string, PermissionScope>;
  features?: Record<string, boolean>;
}

/** The payload is declared `unknown`; this guard narrows it to what the endpoint promises. */
function isPermissionsBody(value: unknown): value is PermissionsBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'permissions' in value &&
    typeof value.permissions === 'object' &&
    value.permissions !== null
  );
}

/** The controller's declared response is `ControllerResponse<unknown>`; this narrows `data`. */
function body(response: ControllerResponse): PermissionsBody {
  if (!response.success || !isPermissionsBody(response.data)) {
    throw new Error('expected the resolved permissions payload');
  }
  return response.data;
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
    it('returns the resolved permissions map', () => {
      const response = controller.listMyPermissions(mockCtx);

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
      expect(body(response).permissions).toBeDefined();
    });

    it('returns only the permissions map (features live on /features/me)', () => {
      const response = controller.listMyPermissions(mockCtx);

      expect(body(response).features).toBeUndefined();
    });

    it('adds default own permissions for student', () => {
      const response = controller.listMyPermissions(mockCtx);

      expect(response.success).toBe(true);
      const perms = body(response).permissions;
      expect(perms['flashcard.read']).toBe('own');
    });

    it('adds own permissions for educator', () => {
      const educatorCtx = { ...mockCtx, accountType: AccountType.EDUCATOR };
      const response = controller.listMyPermissions(educatorCtx);

      expect(response.success).toBe(true);
    });
  });
});
