import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';
import { authService } from '@/server/services/auth.service';

describe('AuthService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
  });

  describe('register', () => {
    it('calls signUp with correct data', async () => {
      mock.auth.signUp.mockResolvedValueOnce({ error: null });

      await authService.register({
        name: 'John Doe',
        email: 'john@example.com',
        password: 'SecurePass1',
      });

      expect(mock.auth.signUp).toHaveBeenCalledWith({
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
      mock.from.mockReturnValue(mockChain);

      await expect(
        authService.register({
          name: 'John Doe',
          email: 'john@example.com',
          password: 'SecurePass1',
          inviteToken: 'invalid-token',
        }),
      ).rejects.toThrow('ERROR_BAD_REQUEST');
    });

    it('throws UNPROCESSABLE_ENTITY when invite email does not match', async () => {
      const mockChain = {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                email: 'different@example.com',
                name: 'John Doe',
                expires_at: new Date(Date.now() + 86400000).toISOString(),
              },
              error: null,
            }),
          }),
        }),
      };
      mock.from.mockReturnValue(mockChain);

      await expect(
        authService.register({
          name: 'John Doe',
          email: 'john@example.com',
          password: 'SecurePass1',
          inviteToken: 'valid-token',
        }),
      ).rejects.toThrow('ERROR_UNPROCESSABLE_ENTITY');
    });

    it('throws UNPROCESSABLE_ENTITY when invite name does not match', async () => {
      const mockChain = {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                email: 'john@example.com',
                name: 'Different Name',
                expires_at: new Date(Date.now() + 86400000).toISOString(),
              },
              error: null,
            }),
          }),
        }),
      };
      mock.from.mockReturnValue(mockChain);

      await expect(
        authService.register({
          name: 'John Doe',
          email: 'john@example.com',
          password: 'SecurePass1',
          inviteToken: 'valid-token',
        }),
      ).rejects.toThrow('ERROR_UNPROCESSABLE_ENTITY');
    });

    it('throws GONE when invite token is expired', async () => {
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

      await expect(
        authService.register({
          name: 'John Doe',
          email: 'john@example.com',
          password: 'SecurePass1',
          inviteToken: 'expired-token',
        }),
      ).rejects.toThrow('ERROR_GONE');
    });

    it('succeeds when invite token is valid', async () => {
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
      mock.auth.signUp.mockResolvedValueOnce({ error: null });

      await expect(
        authService.register({
          name: 'John Doe',
          email: 'john@example.com',
          password: 'SecurePass1',
          inviteToken: 'valid-token',
        }),
      ).resolves.toBeUndefined();
    });

    it('returns early in development when user already exists', async () => {
      vi.stubEnv('NODE_ENV', 'development');

      mock.auth.signUp.mockResolvedValueOnce({
        error: { status: 422, code: 'user_already_exists', message: 'User already registered' },
      });

      await expect(
        authService.register({
          name: 'John Doe',
          email: 'john@example.com',
          password: 'SecurePass1',
        }),
      ).resolves.toBeUndefined();

      vi.unstubAllEnvs();
    });

    it('throws INTERNAL_SERVER when signUp fails in production', async () => {
      vi.stubEnv('NODE_ENV', 'production');

      mock.auth.signUp.mockResolvedValueOnce({
        error: { message: 'Server error' },
      });

      await expect(
        authService.register({
          name: 'John Doe',
          email: 'john@example.com',
          password: 'SecurePass1',
        }),
      ).rejects.toThrow('ERROR_INTERNAL_SERVER');

      vi.unstubAllEnvs();
    });
  });

  describe('login', () => {
    it('returns user when credentials are valid', async () => {
      const mockUser = { id: 'user-1', email: 'john@example.com' };
      mock.auth.signInWithPassword.mockResolvedValueOnce({
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
      mock.auth.signInWithPassword.mockResolvedValueOnce({
        data: { user: null },
        error: { message: 'Invalid credentials' },
      });

      await expect(
        authService.login({ email: 'john@example.com', password: 'wrong' }),
      ).rejects.toThrow('ERROR_UNAUTHORIZED');
    });

    it('throws INTERNAL_SERVER when user is null after successful login', async () => {
      mock.auth.signInWithPassword.mockResolvedValueOnce({
        data: { user: null },
        error: null,
      });

      await expect(
        authService.login({ email: 'john@example.com', password: 'SecurePass1' }),
      ).rejects.toThrow('ERROR_INTERNAL_SERVER');
    });
  });

  describe('logout', () => {
    it('calls signOut with local scope', async () => {
      mock.auth.signOut.mockResolvedValueOnce({ error: null });

      await expect(authService.logout()).resolves.toBeUndefined();
      expect(mock.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    });

    it('throws INTERNAL_SERVER when signOut fails', async () => {
      mock.auth.signOut.mockResolvedValueOnce({ error: { message: 'error' } });

      await expect(authService.logout()).rejects.toThrow('ERROR_INTERNAL_SERVER');
    });
  });

  describe('requestPasswordReset', () => {
    it('calls resetPasswordForEmail', async () => {
      mock.auth.resetPasswordForEmail.mockResolvedValueOnce({ error: null });

      await expect(authService.requestPasswordReset('john@example.com')).resolves.toBeUndefined();
    });

    it('throws BAD_REQUEST when reset fails', async () => {
      mock.auth.resetPasswordForEmail.mockResolvedValueOnce({
        error: { message: 'error' },
      });

      await expect(authService.requestPasswordReset('john@example.com')).rejects.toThrow(
        'ERROR_BAD_REQUEST',
      );
    });
  });

  describe('updatePassword', () => {
    it('calls updateUser with new password', async () => {
      mock.auth.updateUser.mockResolvedValueOnce({ error: null });

      await expect(authService.updatePassword('NewSecure1')).resolves.toBeUndefined();
    });

    it('throws UNPROCESSABLE_ENTITY when same password', async () => {
      mock.auth.updateUser.mockResolvedValueOnce({
        error: { code: 'same_password' },
      });

      await expect(authService.updatePassword('OldSecure1')).rejects.toThrow(
        'ERROR_UNPROCESSABLE_ENTITY',
      );
    });

    it('throws BAD_REQUEST when update fails with generic error', async () => {
      mock.auth.updateUser.mockResolvedValueOnce({
        error: { message: 'Generic error' },
      });

      await expect(authService.updatePassword('NewSecure1')).rejects.toThrow('ERROR_BAD_REQUEST');
    });
  });
});
