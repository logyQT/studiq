import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authService } from './auth.service';
import { createClient } from '@/lib/supabase/server';

const mockSupabase = {
  from: vi.fn(),
  auth: {
    signUp: vi.fn(),
    signInWithPassword: vi.fn(),
    signOut: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    updateUser: vi.fn(),
  },
};

vi.mocked(createClient).mockResolvedValue(mockSupabase as unknown as ReturnType<typeof createClient>);

describe('AuthService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('register', () => {
    it('calls signUp with correct data', async () => {
      mockSupabase.auth.signUp.mockResolvedValueOnce({ error: null });

      await authService.register({
        name: 'John Doe',
        email: 'john@example.com',
        password: 'SecurePass1',
      });

      expect(mockSupabase.auth.signUp).toHaveBeenCalledWith({
        email: 'john@example.com',
        password: 'SecurePass1',
        options: {
          data: {
            name: 'John Doe',
            invite_token: undefined,
          },
        },
      });
    });

    it('validates invite token when provided', async () => {
      const mockChain = {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
          }),
        }),
      };
      mockSupabase.from.mockReturnValue(mockChain);

      await expect(
        authService.register({
          name: 'John Doe',
          email: 'john@example.com',
          password: 'SecurePass1',
          inviteToken: 'invalid-token',
        }),
      ).rejects.toThrow('ERROR_BAD_REQUEST');
    });
  });

  describe('login', () => {
    it('returns user when credentials are valid', async () => {
      const mockUser = { id: 'user-1', email: 'john@example.com' };
      mockSupabase.auth.signInWithPassword.mockResolvedValueOnce({
        data: { user: mockUser },
        error: null,
      });

      const result = await authService.login({
        email: 'john@example.com',
        password: 'SecurePass1',
      });

      expect(result.user).toEqual(mockUser);
    });

    it('throws UNAUTHORIZED when credentials are invalid', async () => {
      mockSupabase.auth.signInWithPassword.mockResolvedValueOnce({
        data: { user: null },
        error: { message: 'Invalid credentials' },
      });

      await expect(
        authService.login({ email: 'john@example.com', password: 'wrong' }),
      ).rejects.toThrow('ERROR_UNAUTHORIZED');
    });
  });

  describe('logout', () => {
    it('calls signOut with local scope', async () => {
      mockSupabase.auth.signOut.mockResolvedValueOnce({ error: null });

      await expect(authService.logout()).resolves.toBeUndefined();
      expect(mockSupabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    });

    it('throws INTERNAL_SERVER when signOut fails', async () => {
      mockSupabase.auth.signOut.mockResolvedValueOnce({ error: { message: 'error' } });

      await expect(authService.logout()).rejects.toThrow('ERROR_INTERNAL_SERVER');
    });
  });

  describe('requestPasswordReset', () => {
    it('calls resetPasswordForEmail', async () => {
      mockSupabase.auth.resetPasswordForEmail.mockResolvedValueOnce({ error: null });

      await expect(authService.requestPasswordReset('john@example.com')).resolves.toBeUndefined();
    });

    it('throws BAD_REQUEST when reset fails', async () => {
      mockSupabase.auth.resetPasswordForEmail.mockResolvedValueOnce({
        error: { message: 'error' },
      });

      await expect(authService.requestPasswordReset('john@example.com')).rejects.toThrow(
        'ERROR_BAD_REQUEST',
      );
    });
  });

  describe('updatePassword', () => {
    it('calls updateUser with new password', async () => {
      mockSupabase.auth.updateUser.mockResolvedValueOnce({ error: null });

      await expect(authService.updatePassword('NewSecure1')).resolves.toBeUndefined();
    });

    it('throws UNPROCESSABLE_ENTITY when same password', async () => {
      mockSupabase.auth.updateUser.mockResolvedValueOnce({
        error: { code: 'same_password' },
      });

      await expect(authService.updatePassword('OldSecure1')).rejects.toThrow(
        'ERROR_UNPROCESSABLE_ENTITY',
      );
    });
  });
});
