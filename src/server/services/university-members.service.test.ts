import { describe, it, expect, vi, beforeEach } from 'vitest';
import { universityMembersService } from './university-members.service';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

describe('UniversityMembersService', () => {
  const userId = 'test-user-id';
  let mock: ReturnType<typeof mockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
  });

  describe('getProfile', () => {
    it('returns profile when found', async () => {
      const profile = {
        id: userId,
        email: 'test@test.com',
        role: 'student',
        university_id: 'uni-1',
      };
      mock.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: profile, error: null }),
          }),
        }),
      });

      const result = await universityMembersService.getProfile(userId);

      expect(result).toEqual(profile);
    });

    it('throws NOT_FOUND when profile does not exist', async () => {
      mock.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      });

      await expect(universityMembersService.getProfile(userId)).rejects.toThrow('ERROR_NOT_FOUND');
    });
  });

  describe('listMembers', () => {
    it('returns members for university', async () => {
      const members = [{ id: 'user-1', role: 'student', university_id: 'uni-1' }];
      mock.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: members, error: null }),
          }),
        }),
      });

      const result = await universityMembersService.listMembers('uni-1');

      expect(result).toEqual(members);
    });

    it('filters by role when roleFilter provided', async () => {
      const members = [{ id: 'user-1', role: 'student', university_id: 'uni-1' }];
      const eqChain = vi.fn();
      const eqFirst = vi.fn().mockReturnValue({
        eq: eqChain.mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: members, error: null }),
        }),
      });
      mock.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: eqFirst,
        }),
      });

      const result = await universityMembersService.listMembers('uni-1', 'student');

      expect(result).toEqual(members);
    });

    it('throws INTERNAL_SERVER when query fails', async () => {
      mock.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
          }),
        }),
      });

      await expect(universityMembersService.listMembers('uni-1')).rejects.toThrow(
        'ERROR_INTERNAL_SERVER',
      );
    });
  });

  describe('changeRole', () => {
    it('changes role successfully', async () => {
      mock.rpc.mockResolvedValue({ error: null });

      const result = await universityMembersService.changeRole(
        userId,
        'user-123',
        'university_admin',
      );

      expect(result).toEqual({ success: true });
      expect(mock.rpc).toHaveBeenCalledWith('admin_change_role', {
        p_target_user: 'user-123',
        p_new_role: 'university_admin',
      });
    });

    it('throws FORBIDDEN when RPC returns Unauthorized', async () => {
      mock.rpc.mockResolvedValue({ error: { message: 'Unauthorized' } });

      await expect(
        universityMembersService.changeRole(userId, 'user-123', 'university_admin'),
      ).rejects.toThrow('ERROR_FORBIDDEN');
    });

    it('throws INTERNAL_SERVER when RPC fails with other error', async () => {
      mock.rpc.mockResolvedValue({ error: { message: 'Some other error' } });

      await expect(
        universityMembersService.changeRole(userId, 'user-123', 'university_admin'),
      ).rejects.toThrow('ERROR_INTERNAL_SERVER');
    });
  });

  describe('removeMember', () => {
    it('removes member successfully', async () => {
      mock.rpc.mockResolvedValue({ error: null });

      const result = await universityMembersService.removeMember(userId, 'user-123');

      expect(result).toEqual({ success: true });
    });

    it('throws FORBIDDEN when RPC returns Unauthorized', async () => {
      mock.rpc.mockResolvedValue({ error: { message: 'Unauthorized' } });

      await expect(universityMembersService.removeMember(userId, 'user-123')).rejects.toThrow(
        'ERROR_FORBIDDEN',
      );
    });
  });
});
