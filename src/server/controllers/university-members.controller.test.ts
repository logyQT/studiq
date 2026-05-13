import { describe, it, expect, vi, beforeEach } from 'vitest';
import { universityMembersController } from './university-members.controller';
import { universityMembersService } from '@/server/services';
import { AppError } from '@/lib/errors';

vi.mock('@/server/services', () => ({
  universityMembersService: {
    getProfile: vi.fn(),
    listMembers: vi.fn(),
    changeRole: vi.fn(),
    removeMember: vi.fn(),
  },
}));

const mockService = vi.mocked(universityMembersService);

describe('UniversityMembersController', () => {
  const userId = 'test-user-id';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listMembers', () => {
    it('returns members when user has university', async () => {
      mockService.getProfile.mockResolvedValueOnce({ id: userId, university_id: 'uni-1' });
      const members = [{ id: 'user-1', role: 'student' }];
      mockService.listMembers.mockResolvedValueOnce(members);

      const response = await universityMembersController.listMembers(userId);

      expect(response).toEqual({ success: true, statusCode: 200, data: members });
    });

    it('returns FORBIDDEN when user has no university', async () => {
      mockService.getProfile.mockResolvedValueOnce({ id: userId, university_id: null });

      const response = await universityMembersController.listMembers(userId);

      expect(response).toEqual({ success: false, statusCode: 403, error: 'FORBIDDEN' });
    });

    it('passes roleFilter to service', async () => {
      mockService.getProfile.mockResolvedValueOnce({ id: userId, university_id: 'uni-1' });
      mockService.listMembers.mockResolvedValueOnce([]);

      await universityMembersController.listMembers(userId, 'student');

      expect(mockService.listMembers).toHaveBeenCalledWith('uni-1', 'student');
    });
  });

  describe('changeRole', () => {
    it('returns success when service changes role successfully', async () => {
      const body = { targetUserId: 'user-123', newRole: 'university_admin' };
      mockService.changeRole.mockResolvedValueOnce({ success: true });

      const response = await universityMembersController.changeRole(userId, body);

      expect(response).toEqual({ success: true, statusCode: 200, data: { success: true } });
    });

    it('returns UNPROCESSABLE_ENTITY when body fails validation', async () => {
      const response = await universityMembersController.changeRole(userId, {
        targetUserId: '',
        newRole: 'invalid',
      });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect(response.error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('returns error when service throws AppError', async () => {
      mockService.changeRole.mockRejectedValueOnce(new AppError('FORBIDDEN'));

      const response = await universityMembersController.changeRole(userId, {
        targetUserId: 'user-123',
        newRole: 'university_admin',
      });

      expect(response).toEqual({ success: false, statusCode: 403, error: 'FORBIDDEN' });
    });
  });

  describe('removeMember', () => {
    it('returns success when service removes member successfully', async () => {
      mockService.removeMember.mockResolvedValueOnce({ success: true });

      const response = await universityMembersController.removeMember(userId, 'user-123');

      expect(response).toEqual({ success: true, statusCode: 200, data: { success: true } });
    });

    it('returns BAD_REQUEST when targetUserId is empty', async () => {
      const response = await universityMembersController.removeMember(userId, '');

      expect(response).toEqual({ success: false, statusCode: 400, error: 'BAD_REQUEST' });
    });

    it('returns error when service throws AppError', async () => {
      mockService.removeMember.mockRejectedValueOnce(new AppError('FORBIDDEN'));

      const response = await universityMembersController.removeMember(userId, 'user-123');

      expect(response).toEqual({ success: false, statusCode: 403, error: 'FORBIDDEN' });
    });
  });
});
