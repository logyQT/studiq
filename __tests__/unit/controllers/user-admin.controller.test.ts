import { UserAdminController } from '@admin/server/controllers/user-admin.controller';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const USER_ID = '11111111-1111-4111-8111-111111111111';

function createMockService() {
  return {
    listUsers: vi.fn(),
    getUser: vi.fn(),
    createUser: vi.fn(),
    updateAccountType: vi.fn(),
    softDeleteUser: vi.fn(),
    restoreUser: vi.fn(),
    purgeNow: vi.fn(),
    purgeExpired: vi.fn(),
  };
}

let mockService: ReturnType<typeof createMockService>;
let controller: UserAdminController;

describe('UserAdminController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockService();
    controller = new UserAdminController(mockService as any);
  });

  describe('list', () => {
    it('returns the page', async () => {
      mockService.listUsers.mockResolvedValueOnce({ success: true, data: { users: [] } });
      const response = await controller.list({ status: 'active' });
      expect(response.success).toBe(true);
      expect(mockService.listUsers).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'active', page: 1, perPage: 50 }),
      );
    });

    it('rejects an invalid status', async () => {
      const response = await controller.list({ status: 'bogus' });
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });
  });

  describe('getById', () => {
    it('returns the user', async () => {
      mockService.getUser.mockResolvedValueOnce({ success: true, data: { id: USER_ID } });
      const response = await controller.getById(USER_ID);
      expect(response.success).toBe(true);
      expect(mockService.getUser).toHaveBeenCalledWith(USER_ID);
    });

    it('returns error on service failure', async () => {
      mockService.getUser.mockResolvedValueOnce({ success: false, error: 'NOT_FOUND' });
      const response = await controller.getById(USER_ID);
      expect(response.success).toBe(false);
    });

    it('rejects a non-UUID id without calling the service', async () => {
      const response = await controller.getById('not-a-uuid');
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect(mockService.getUser).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('creates a user', async () => {
      mockService.createUser.mockResolvedValueOnce({ success: true, data: { id: USER_ID } });
      const response = await controller.create({
        email: 'new@dev.local',
        password: 'password123',
        accountType: 'student',
      });
      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(201);
    });

    it('returns 422 on a short password', async () => {
      const response = await controller.create({
        email: 'new@dev.local',
        password: 'short',
        accountType: 'student',
      });
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });

    it('returns 422 on an invalid account type', async () => {
      const response = await controller.create({
        email: 'new@dev.local',
        password: 'password123',
        accountType: 'sys_admin',
      });
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });
  });

  describe('updateAccountType', () => {
    it('updates the account type', async () => {
      mockService.updateAccountType.mockResolvedValueOnce({ success: true, data: { id: USER_ID } });
      const response = await controller.updateAccountType(USER_ID, { accountType: 'manager' });
      expect(response.success).toBe(true);
      expect(mockService.updateAccountType).toHaveBeenCalledWith(USER_ID, 'manager');
    });

    it('returns 422 on an invalid account type', async () => {
      const response = await controller.updateAccountType(USER_ID, { accountType: 'nope' });
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect(mockService.updateAccountType).not.toHaveBeenCalled();
    });

    it('returns 422 on a non-UUID id', async () => {
      const response = await controller.updateAccountType('not-a-uuid', { accountType: 'manager' });
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect(mockService.updateAccountType).not.toHaveBeenCalled();
    });
  });

  describe('softDelete', () => {
    it('soft-deletes the user', async () => {
      mockService.softDeleteUser.mockResolvedValueOnce({
        success: true,
        data: { purgeAt: '2026-10-29T00:00:00.000Z' },
      });
      const response = await controller.softDelete(USER_ID);
      expect(response.success).toBe(true);
    });

    it('returns 422 on a non-UUID id', async () => {
      const response = await controller.softDelete('not-a-uuid');
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect(mockService.softDeleteUser).not.toHaveBeenCalled();
    });
  });

  describe('restore', () => {
    it('restores the user', async () => {
      mockService.restoreUser.mockResolvedValueOnce({ success: true, data: { success: true } });
      const response = await controller.restore(USER_ID);
      expect(response.success).toBe(true);
    });

    it('returns 422 on a non-UUID id', async () => {
      const response = await controller.restore('not-a-uuid');
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect(mockService.restoreUser).not.toHaveBeenCalled();
    });
  });

  describe('purgeNow', () => {
    it('purges the user', async () => {
      mockService.purgeNow.mockResolvedValueOnce({ success: true, data: { success: true } });
      const response = await controller.purgeNow(USER_ID);
      expect(response.success).toBe(true);
    });

    it('returns error when the user is not soft-deleted', async () => {
      mockService.purgeNow.mockResolvedValueOnce({ success: false, error: 'BAD_REQUEST' });
      const response = await controller.purgeNow(USER_ID);
      expect(response.success).toBe(false);
    });

    it('returns 422 on a non-UUID id', async () => {
      const response = await controller.purgeNow('not-a-uuid');
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect(mockService.purgeNow).not.toHaveBeenCalled();
    });
  });

  describe('purgeExpired', () => {
    it('returns the purge counts from the service', async () => {
      mockService.purgeExpired.mockResolvedValueOnce({
        success: true,
        data: { purged: 2, failed: 1 },
      });
      const response = await controller.purgeExpired();
      expect(response.success).toBe(true);
      if (!response.success) return;
      expect(response.data).toEqual({ purged: 2, failed: 1 });
    });

    it('surfaces a service failure instead of a hardcoded success', async () => {
      mockService.purgeExpired.mockResolvedValueOnce({ success: false, error: 'INTERNAL_SERVER' });
      const response = await controller.purgeExpired();
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(500);
    });
  });
});
