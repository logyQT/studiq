import { UserAdminController } from '@admin/server/controllers/user-admin.controller';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
      mockService.getUser.mockResolvedValueOnce({ success: true, data: { id: 'u-1' } });
      const response = await controller.getById('u-1');
      expect(response.success).toBe(true);
    });

    it('returns error on service failure', async () => {
      mockService.getUser.mockResolvedValueOnce({ success: false, error: 'NOT_FOUND' });
      const response = await controller.getById('u-1');
      expect(response.success).toBe(false);
    });
  });

  describe('create', () => {
    it('creates a user', async () => {
      mockService.createUser.mockResolvedValueOnce({ success: true, data: { id: 'u-1' } });
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
      mockService.updateAccountType.mockResolvedValueOnce({ success: true, data: { id: 'u-1' } });
      const response = await controller.updateAccountType('u-1', { accountType: 'manager' });
      expect(response.success).toBe(true);
      expect(mockService.updateAccountType).toHaveBeenCalledWith('u-1', 'manager');
    });

    it('returns 422 on an invalid account type', async () => {
      const response = await controller.updateAccountType('u-1', { accountType: 'nope' });
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });
  });

  describe('softDelete', () => {
    it('soft-deletes the user', async () => {
      mockService.softDeleteUser.mockResolvedValueOnce({
        success: true,
        data: { purgeAt: '2026-10-29T00:00:00.000Z' },
      });
      const response = await controller.softDelete('u-1');
      expect(response.success).toBe(true);
    });
  });

  describe('restore', () => {
    it('restores the user', async () => {
      mockService.restoreUser.mockResolvedValueOnce({ success: true, data: { success: true } });
      const response = await controller.restore('u-1');
      expect(response.success).toBe(true);
    });
  });

  describe('purgeNow', () => {
    it('purges the user', async () => {
      mockService.purgeNow.mockResolvedValueOnce({ success: true, data: { success: true } });
      const response = await controller.purgeNow('u-1');
      expect(response.success).toBe(true);
    });

    it('returns error when the user is not soft-deleted', async () => {
      mockService.purgeNow.mockResolvedValueOnce({ success: false, error: 'BAD_REQUEST' });
      const response = await controller.purgeNow('u-1');
      expect(response.success).toBe(false);
    });
  });

  describe('purgeExpired', () => {
    it('always succeeds', async () => {
      const response = await controller.purgeExpired();
      expect(response.success).toBe(true);
      expect(mockService.purgeExpired).toHaveBeenCalled();
    });
  });
});
