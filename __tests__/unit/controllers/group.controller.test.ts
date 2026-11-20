import { AccountType, type RequestContext } from '@studiq/authz';
import { GroupController } from '@studiq/server/controllers/group.controller';
import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { GroupService } from '@studiq/server/services/group.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function createMockService() {
  // The mocked methods never touch the database, so the client factory only
  // has to satisfy the constructor's type.
  return Object.assign(new GroupService(() => Promise.reject(new Error('unused'))), {
    listGroups: vi.fn(),
    createGroup: vi.fn(),
    updateGroup: vi.fn(),
    deleteGroup: vi.fn(),
    getGroupMembers: vi.fn(),
    listAddableMembers: vi.fn(),
    setGroupMembers: vi.fn(),
    listMyGroups: vi.fn(),
  });
}

let mockService: ReturnType<typeof createMockService>;
let controller: GroupController;

const mockCtx: RequestContext = {
  traceId: 'test-trace',
  userId: 'test-user-id',
  accountType: AccountType.EDUCATOR,
  orgRoleId: null,
  activeOrgId: 'org-1',
  url: 'http://localhost',
  method: 'GET',
  groupIds: [],
  groupRoles: {},
  // Creating a group needs `group.manage` at any scope (ADR-0015 §4.3, §10 — a
  // Teacher creates their class); the cases that probe a refusal replace this map.
  permissionScopes: { 'group.manage': 'organization' },
};

describe('GroupController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockService();
    controller = new GroupController(mockService);
  });

  describe('listGroups', () => {
    it('leaves group.read to the service, which is the only reader that has a row', async () => {
      // `group.read` at `own` reaches the classes the caller created, and a
      // controller has no row to ask about — so the controller must not gate the
      // list. A refuse-here version would answer 403 for every listing and the
      // service's scope resolution would never run.
      mockService.listGroups.mockResolvedValueOnce({ success: true, data: [] });

      const response = await controller.listGroups({ ...mockCtx, permissionScopes: {} });

      expect(response).toMatchObject({ success: true, statusCode: 200 });
      expect(mockService.listGroups).toHaveBeenCalledWith({ ...mockCtx, permissionScopes: {} });
    });

    it("passes the service's row-scoped 403 through", async () => {
      mockService.listGroups.mockResolvedValueOnce({ success: false, error: 'FORBIDDEN' });

      const response = await controller.listGroups({ ...mockCtx, permissionScopes: {} });

      expect(response).toMatchObject({ success: false, statusCode: 403, error: 'FORBIDDEN' });
    });

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
      expect(response).toHaveProperty('data', group);
    });

    it('refuses a group without any group.manage before the service runs', async () => {
      await expect(
        controller.createGroup({ ...mockCtx, permissionScopes: {} }, { name: 'New Group' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(mockService.createGroup).not.toHaveBeenCalled();
    });

    it('lets a group.manage at group scope create a class (a Teacher)', async () => {
      // The 2b-2 decision: a Teacher creates their own class, so the controller
      // must not demand `organization` scope from a role the service admits.
      mockService.createGroup.mockResolvedValueOnce({
        success: true,
        data: { id: 'g-2', name: 'New Group', description: null, created_at: '2024-01-01' },
      });

      const response = await controller.createGroup(
        { ...mockCtx, permissionScopes: { 'group.manage': 'group' } },
        { name: 'New Group' },
      );

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(201);
      expect(mockService.createGroup).toHaveBeenCalled();
    });

    it('lets an own-scope group.manage create a class', async () => {
      mockService.createGroup.mockResolvedValueOnce({
        success: true,
        data: { id: 'g-3', name: 'New Group', description: null, created_at: '2024-01-01' },
      });

      const response = await controller.createGroup(
        { ...mockCtx, permissionScopes: { 'group.manage': 'own' } },
        { name: 'New Group' },
      );

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(201);
    });

    it('returns 422 on invalid body', async () => {
      const response = await controller.createGroup(mockCtx, { name: '' });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });

    it('rejects a whitespace-only name without calling the service', async () => {
      const response = await controller.createGroup(mockCtx, { name: '   ' });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      if (!response.success) {
        expect(response.error).toBe('UNPROCESSABLE_ENTITY');
        expect(response.details?.[0]?.path).toEqual(['name']);
        expect(response.details?.[0]?.message).toBe(ValidationErrorCode.REQUIRED);
      }
      expect(mockService.createGroup).not.toHaveBeenCalled();
    });

    it('passes the trimmed name to the service', async () => {
      mockService.createGroup.mockResolvedValueOnce({ success: true, data: {} });

      await controller.createGroup(mockCtx, { name: '  My Group  ' });

      expect(mockService.createGroup).toHaveBeenCalledWith(mockCtx, { name: 'My Group' });
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

    it('accepts a null description and passes it to the service', async () => {
      mockService.updateGroup.mockResolvedValueOnce({ success: true, data: {} });

      const response = await controller.updateGroup(
        mockCtx,
        '550e8400-e29b-41d4-a716-446655440000',
        { name: 'Updated', description: null },
      );

      expect(response.success).toBe(true);
      expect(mockService.updateGroup).toHaveBeenCalledWith(
        mockCtx,
        '550e8400-e29b-41d4-a716-446655440000',
        { name: 'Updated', description: null },
      );
    });

    it('does not add a description key when absent from the body', async () => {
      mockService.updateGroup.mockResolvedValueOnce({ success: true, data: {} });

      await controller.updateGroup(mockCtx, '550e8400-e29b-41d4-a716-446655440000', {
        name: 'Updated',
      });

      expect(mockService.updateGroup.mock.calls.at(-1)?.[2]).not.toHaveProperty('description');
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

    it('rejects a whitespace-only name without calling the service', async () => {
      const response = await controller.updateGroup(
        mockCtx,
        '550e8400-e29b-41d4-a716-446655440000',
        { name: '   ', description: 'Opis do usunięcia' },
      );

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      if (!response.success) {
        expect(response.error).toBe('UNPROCESSABLE_ENTITY');
        expect(response.details?.[0]?.path).toEqual(['name']);
        expect(response.details?.[0]?.message).toBe(ValidationErrorCode.REQUIRED);
      }
      expect(mockService.updateGroup).not.toHaveBeenCalled();
    });

    it('passes the trimmed name to the service and keeps description absent', async () => {
      mockService.updateGroup.mockResolvedValueOnce({ success: true, data: {} });

      await controller.updateGroup(mockCtx, '550e8400-e29b-41d4-a716-446655440000', {
        name: '  Updated  ',
      });

      const payload: unknown = mockService.updateGroup.mock.calls.at(-1)?.[2];
      expect(payload).toEqual({ name: 'Updated' });
      expect(payload).not.toHaveProperty('description');
    });

    it('returns 400 on invalid params', async () => {
      const response = await controller.updateGroup(mockCtx, 'invalid-id', { name: 'Updated' });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(400);
    });

    it('gates per group in the service and cannot answer 403 itself', async () => {
      // A teacher of THIS class holds `group.manage` at `group` scope, so a
      // create-style gate in the controller (the `canCreateGroup` call a later
      // author reaches for) would refuse a caller the service admits. The double
      // refuses the way the real service does, after resolving the row.
      mockService.updateGroup.mockResolvedValueOnce({ success: false, error: 'FORBIDDEN' });

      const response = await controller.updateGroup(
        { ...mockCtx, permissionScopes: { 'group.manage': 'group' } },
        '550e8400-e29b-41d4-a716-446655440000',
        { name: 'Updated' },
      );

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(403);
      expect(mockService.updateGroup).toHaveBeenCalled();
    });

    it('returns error on service failure', async () => {
      mockService.updateGroup.mockResolvedValueOnce({ success: false, error: 'NOT_FOUND' });

      const response = await controller.updateGroup(
        mockCtx,
        '550e8400-e29b-41d4-a716-446655440000',
        { name: 'Updated' },
      );

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(404);
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
      expect(response.statusCode).toBe(403);
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
