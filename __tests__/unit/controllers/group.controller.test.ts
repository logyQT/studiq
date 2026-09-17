import type { RequestContext } from '@studiq/authz';
import { GroupController } from '@studiq/server/controllers/group.controller';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/features', () => ({
  requireFeature: vi.fn().mockResolvedValue(undefined),
}));

function createMockService() {
  return {
    listGroups: vi.fn(),
    createGroup: vi.fn(),
    updateGroup: vi.fn(),
    deleteGroup: vi.fn(),
    getGroupMembers: vi.fn(),
    listAddableMembers: vi.fn(),
    setGroupMembers: vi.fn(),
    listMyGroups: vi.fn(),
  };
}

let mockService: ReturnType<typeof createMockService>;
let controller: GroupController;

const mockCtx: RequestContext = {
  traceId: 'test-trace',
  userId: 'test-user-id',
  accountType: 'educator' as any,
  orgRoleId: null,
  activeOrgId: 'org-1',
  url: 'http://localhost',
  method: 'GET',
  groupIds: [],
  permissionScopes: {},
};

describe('GroupController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockService();
    controller = new GroupController(mockService as any);
  });

  describe('listGroups', () => {
    it('returns groups on success', async () => {
      mockService.listGroups.mockResolvedValueOnce({ success: true, data: [] });

      const response = await controller.listGroups(mockCtx);

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
    });

    it('returns error on failure', async () => {
      mockService.listGroups.mockResolvedValueOnce({ success: false, error: 'INTERNAL_SERVER' });

      const response = await controller.listGroups(mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(500);
    });
  });

  describe('createGroup', () => {
    it('returns created group', async () => {
      const group = { id: 'g-1', name: 'New Group', description: null, created_at: '2024-01-01' };
      mockService.createGroup.mockResolvedValueOnce({ success: true, data: group });

      const response = await controller.createGroup(mockCtx, { name: 'New Group' });

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(201);
      expect((response as any).data).toEqual(group);
    });

    it('returns 422 on invalid body', async () => {
      const response = await controller.createGroup(mockCtx, { name: '' });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });

    it('returns error on service failure', async () => {
      mockService.createGroup.mockResolvedValueOnce({ success: false, error: 'FORBIDDEN' });

      const response = await controller.createGroup(mockCtx, { name: 'New Group' });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(403);
    });
  });

  describe('updateGroup', () => {
    it('returns updated group', async () => {
      const group = { id: 'g-1', name: 'Updated', description: null, created_at: '2024-01-01' };
      mockService.updateGroup.mockResolvedValueOnce({ success: true, data: group });

      const response = await controller.updateGroup(
        mockCtx,
        '550e8400-e29b-41d4-a716-446655440000',
        { name: 'Updated' },
      );

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
    });

    it('returns 422 on invalid body', async () => {
      const response = await controller.updateGroup(
        mockCtx,
        '550e8400-e29b-41d4-a716-446655440000',
        { name: '' },
      );

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });

    it('returns 400 on invalid params', async () => {
      const response = await controller.updateGroup(mockCtx, 'invalid-id', { name: 'Updated' });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(400);
    });

    it('returns error on service failure', async () => {
      mockService.updateGroup.mockResolvedValueOnce({ success: false, error: 'NOT_FOUND' });

      const response = await controller.updateGroup(
        mockCtx,
        '550e8400-e29b-41d4-a716-446655440000',
        { name: 'Updated' },
      );

      expect(response.success).toBe(false);
    });
  });

  describe('deleteGroup', () => {
    it('returns success', async () => {
      mockService.deleteGroup.mockResolvedValueOnce({ success: true, data: undefined });

      const response = await controller.deleteGroup(
        mockCtx,
        '550e8400-e29b-41d4-a716-446655440000',
      );

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
    });

    it('returns 400 on invalid params', async () => {
      const response = await controller.deleteGroup(mockCtx, 'invalid');

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(400);
    });

    it('returns error on service failure', async () => {
      mockService.deleteGroup.mockResolvedValueOnce({ success: false, error: 'FORBIDDEN' });

      const response = await controller.deleteGroup(
        mockCtx,
        '550e8400-e29b-41d4-a716-446655440000',
      );

      expect(response.success).toBe(false);
    });
  });

  describe('getGroupMembers', () => {
    it('returns members', async () => {
      mockService.getGroupMembers.mockResolvedValueOnce({ success: true, data: [] });

      const response = await controller.getGroupMembers(
        mockCtx,
        '550e8400-e29b-41d4-a716-446655440000',
      );

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
    });

    it('returns 400 on invalid params', async () => {
      const response = await controller.getGroupMembers(mockCtx, 'invalid');

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(400);
    });
  });

  describe('listAddableMembers', () => {
    it('returns addable members', async () => {
      mockService.listAddableMembers.mockResolvedValueOnce({ success: true, data: [] });

      const response = await controller.listAddableMembers(
        mockCtx,
        '550e8400-e29b-41d4-a716-446655440000',
      );

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
    });

    it('returns 400 on invalid params', async () => {
      const response = await controller.listAddableMembers(mockCtx, 'invalid');

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(400);
    });

    it('returns error on service failure', async () => {
      mockService.listAddableMembers.mockResolvedValueOnce({ success: false, error: 'FORBIDDEN' });

      const response = await controller.listAddableMembers(
        mockCtx,
        '550e8400-e29b-41d4-a716-446655440000',
      );

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(403);
    });
  });

  describe('setGroupMembers', () => {
    it('returns success', async () => {
      mockService.setGroupMembers.mockResolvedValueOnce({ success: true, data: undefined });

      const response = await controller.setGroupMembers(
        mockCtx,
        '550e8400-e29b-41d4-a716-446655440000',
        {
          members: [{ userId: '550e8400-e29b-41d4-a716-446655440001', role: 'teacher' }],
        },
      );

      expect(response.success).toBe(true);
    });

    it('returns 422 on invalid body', async () => {
      const response = await controller.setGroupMembers(
        mockCtx,
        '550e8400-e29b-41d4-a716-446655440000',
        {
          members: 'invalid',
        },
      );

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });

    it('returns 400 on invalid params', async () => {
      const response = await controller.setGroupMembers(mockCtx, 'invalid', {
        members: [],
      });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(400);
    });
  });

  describe('listMyGroups', () => {
    it('returns my groups', async () => {
      mockService.listMyGroups.mockResolvedValueOnce({ success: true, data: [] });

      const response = await controller.listMyGroups(mockCtx);

      expect(response.success).toBe(true);
    });

    it('returns error on failure', async () => {
      mockService.listMyGroups.mockResolvedValueOnce({ success: false, error: 'INTERNAL_SERVER' });

      const response = await controller.listMyGroups(mockCtx);

      expect(response.success).toBe(false);
    });
  });
});
