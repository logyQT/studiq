import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PermissionsController } from '@/server/controllers/permissions.controller';
import type { RequestContext } from '@/lib/request-context';

vi.mock('@/lib/features', () => ({
  getEnabledFeatures: vi.fn().mockResolvedValue([]),
}));

const mockCtx: RequestContext = {
  traceId: 'test', userId: 'u-1', accountType: 'student' as any,
  orgRoleId: null, activeOrgId: null, url: '', method: 'GET', groupIds: [],
  permissionScopes: { 'flashcard.read': 'own' },
};

describe('PermissionsController', () => {
  let controller: PermissionsController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new PermissionsController();
  });

  describe('listMyPermissions', () => {
    it('returns permissions and features', async () => {
      const response = await controller.listMyPermissions(mockCtx);

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
      expect((response as any).data.permissions).toBeDefined();
      expect((response as any).data.features).toBeDefined();
    });

    it('adds default own permissions for student', async () => {
      const response = await controller.listMyPermissions(mockCtx);

      expect(response.success).toBe(true);
      const perms = (response as any).data.permissions;
      expect(perms['flashcard.read']).toBe('own');
    });

    it('adds own permissions for educator', async () => {
      const educatorCtx = { ...mockCtx, accountType: 'educator' as any };
      const response = await controller.listMyPermissions(educatorCtx);

      expect(response.success).toBe(true);
    });
  });
});
