import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';
import { organizationMemberService } from '@/server/services/organization-member.service';

describe('OrganizationMemberService', () => {
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
        account_type: 'student',
        organization_id: 'uni-1',
      };
      mock.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: profile, error: null }),
          }),
        }),
      });

      const result = await organizationMemberService.getProfile(userId);

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

      await expect(organizationMemberService.getProfile(userId)).rejects.toThrow('ERROR_NOT_FOUND');
    });
  });

  describe('listMembers', () => {
    it('returns members for organization', async () => {
      const members = [{ id: 'user-1', account_type: 'student', organization_id: 'uni-1' }];
      mock.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: members, error: null }),
          }),
        }),
      });

      const result = await organizationMemberService.listMembers('uni-1');

      expect(result).toEqual(members);
    });

    it('filters by role when roleFilter provided', async () => {
      const members = [{ id: 'user-1', account_type: 'student', organization_id: 'uni-1' }];
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

      const result = await organizationMemberService.listMembers('uni-1', 'student');

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

      await expect(organizationMemberService.listMembers('uni-1')).rejects.toThrow(
        'ERROR_INTERNAL_SERVER',
      );
    });
  });

  describe('changeRole', () => {
    it('changes role successfully', async () => {
      mock.rpc.mockResolvedValue({ error: null });

      const result = await organizationMemberService.changeRole(
        userId,
        'user-123',
        '00000000-0000-4000-8000-000000000001',
      );

      expect(result).toEqual({ success: true });
      expect(mock.rpc).toHaveBeenCalledWith('admin_change_role', {
        p_target_user: 'user-123',
        p_new_org_role_id: '00000000-0000-4000-8000-000000000001',
      });
    });

    it('throws FORBIDDEN when RPC returns Unauthorized', async () => {
      mock.rpc.mockResolvedValue({ error: { message: 'Unauthorized' } });

      await expect(
        organizationMemberService.changeRole(userId, 'user-123', '00000000-0000-4000-8000-000000000001'),
      ).rejects.toThrow('ERROR_FORBIDDEN');
    });

    it('throws INTERNAL_SERVER when RPC fails with other error', async () => {
      mock.rpc.mockResolvedValue({ error: { message: 'Some other error' } });

      await expect(
        organizationMemberService.changeRole(userId, 'user-123', '00000000-0000-4000-8000-000000000001'),
      ).rejects.toThrow('ERROR_INTERNAL_SERVER');
    });
  });

  describe('removeMember', () => {
    it('removes member successfully', async () => {
      mock.rpc.mockResolvedValue({ error: null });

      const result = await organizationMemberService.removeMember(userId, 'user-123');

      expect(result).toEqual({ success: true });
    });

    it('throws FORBIDDEN when RPC returns Unauthorized', async () => {
      mock.rpc.mockResolvedValue({ error: { message: 'Unauthorized' } });

      await expect(organizationMemberService.removeMember(userId, 'user-123')).rejects.toThrow(
        'ERROR_FORBIDDEN',
      );
    });
  });
});
