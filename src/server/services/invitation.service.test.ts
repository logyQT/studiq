import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invitationService } from './invitation.service';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';
import { UserRole } from '@/types';

describe('InvitationService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  const userId = 'test-user-id';

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
  });

  describe('createInvitation', () => {
    it('throws NOT_FOUND when inviter profile does not exist', async () => {
      const mockChain = {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      };
      mock.from.mockReturnValue(mockChain);

      await expect(
        invitationService.createInvitation(userId, {
          name: 'John Doe',
          email: 'john@example.com',
          role: UserRole.STUDENT,
        }),
      ).rejects.toThrow('ERROR_NOT_FOUND');
    });

    it('throws FORBIDDEN when university_admin has no university_id', async () => {
      const mockChain = {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: userId, university_id: null, role: 'university_admin' },
              error: null,
            }),
          }),
        }),
      };
      mock.from.mockReturnValue(mockChain);

      await expect(
        invitationService.createInvitation(userId, {
          name: 'John Doe',
          email: 'john@example.com',
          role: UserRole.STUDENT,
        }),
      ).rejects.toThrow('ERROR_FORBIDDEN');
    });

    it('throws NOT_FOUND when sys_admin provides no universityId', async () => {
      const mockChain = {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: userId, university_id: null, role: 'sys_admin' },
              error: null,
            }),
          }),
        }),
      };
      mock.from.mockReturnValue(mockChain);

      await expect(
        invitationService.createInvitation(userId, {
          name: 'John Doe',
          email: 'john@example.com',
          role: UserRole.STUDENT,
        }),
      ).rejects.toThrow('ERROR_NOT_FOUND');
    });
  });

  describe('getInvitationByToken', () => {
    it('returns invitation when found and valid', async () => {
      const mockChain = {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                email: 'john@example.com',
                name: 'John Doe',
                expires_at: new Date(Date.now() + 86400000).toISOString(),
              },
              error: null,
            }),
          }),
        }),
      };
      mock.from.mockReturnValue(mockChain);

      const result = await invitationService.getInvitationByToken('valid-token');

      expect(result).toEqual({ email: 'john@example.com', name: 'John Doe' });
    });

    it('throws NOT_FOUND when token does not exist', async () => {
      const mockChain = {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      };
      mock.from.mockReturnValue(mockChain);

      await expect(invitationService.getInvitationByToken('invalid')).rejects.toThrow(
        'ERROR_NOT_FOUND',
      );
    });

    it('throws GONE when token is expired', async () => {
      const mockChain = {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                email: 'john@example.com',
                name: 'John Doe',
                expires_at: new Date(Date.now() - 86400000).toISOString(),
              },
              error: null,
            }),
          }),
        }),
      };
      mock.from.mockReturnValue(mockChain);

      await expect(invitationService.getInvitationByToken('expired')).rejects.toThrow('ERROR_GONE');
    });
  });
});
