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

    it('creates invitation successfully for sys_admin with universityId', async () => {
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
      const insertChain = {
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { token: 'abc123' }, error: null }),
          }),
        }),
      };
      mock.from.mockReturnValueOnce(mockChain);
      mock.from.mockReturnValueOnce(insertChain);

      vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000');
      vi.stubEnv('NODE_ENV', 'development');

      const result = await invitationService.createInvitation(userId, {
        name: 'John Doe',
        email: 'john@example.com',
        role: UserRole.STUDENT,
        universityId: 'uni-1',
      });

      expect(result.success).toBe(true);
      expect(result.inviteLink).toContain('abc123');

      vi.unstubAllEnvs();
    });

    it('creates invitation successfully for university_admin with university_id', async () => {
      const mockChain = {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: userId, university_id: 'uni-1', role: 'university_admin' },
              error: null,
            }),
          }),
        }),
      };
      const insertChain = {
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { token: 'abc123' }, error: null }),
          }),
        }),
      };
      mock.from.mockReturnValueOnce(mockChain);
      mock.from.mockReturnValueOnce(insertChain);

      vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000');
      vi.stubEnv('NODE_ENV', 'development');

      const result = await invitationService.createInvitation(userId, {
        name: 'John Doe',
        email: 'john@example.com',
        role: UserRole.STUDENT,
      });

      expect(result.success).toBe(true);

      vi.unstubAllEnvs();
    });

    it('throws INTERNAL_SERVER when SITE_URL is not set', async () => {
      const mockChain = {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: userId, university_id: 'uni-1', role: 'university_admin' },
              error: null,
            }),
          }),
        }),
      };
      const insertChain = {
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { token: 'abc123' }, error: null }),
          }),
        }),
      };
      mock.from.mockReturnValueOnce(mockChain);
      mock.from.mockReturnValueOnce(insertChain);

      vi.stubEnv('NEXT_PUBLIC_SITE_URL', undefined as any);

      await expect(
        invitationService.createInvitation(userId, {
          name: 'John Doe',
          email: 'john@example.com',
          role: UserRole.STUDENT,
        }),
      ).rejects.toThrow('ERROR_INTERNAL_SERVER');

      vi.unstubAllEnvs();
    });

    it('throws INTERNAL_SERVER when insert fails', async () => {
      const mockChain = {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: userId, university_id: 'uni-1', role: 'university_admin' },
              error: null,
            }),
          }),
        }),
      };
      const insertChain = {
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
          }),
        }),
      };
      mock.from.mockReturnValueOnce(mockChain);
      mock.from.mockReturnValueOnce(insertChain);

      await expect(
        invitationService.createInvitation(userId, {
          name: 'John Doe',
          email: 'john@example.com',
          role: UserRole.STUDENT,
        }),
      ).rejects.toThrow('ERROR_INTERNAL_SERVER');
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
