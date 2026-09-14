import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';
import { AuthService } from '@/server/services/auth.service';

describe('AuthService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  let service: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
    service = new AuthService(async () => mock as any);
  });

  describe('register', () => {
    it('calls signUp with correct data', async () => {
      mock.auth.signUp.mockResolvedValueOnce({ data: { user: { id: '00000000-0000-0000-0000-000000000001' } }, error: null });

      const result = await service.register({
        name: 'John Doe',
        email: 'john@example.com',
        password: 'SecurePass1',
      });

      expect(result.success).toBe(true);
      expect(mock.auth.signUp).toHaveBeenCalledWith({
        email: 'john@example.com',
        password: 'SecurePass1',
        options: {
          data: {
            name: 'John Doe',
            account_type: undefined,
          },
        },
      });
    });

    it('returns early in development when user already exists', async () => {
      vi.stubEnv('NODE_ENV', 'development');

      mock.auth.signUp.mockResolvedValueOnce({
        data: {},
        error: { status: 422, code: 'user_already_exists', message: 'User already registered' },
      });

      const result = await service.register({
        name: 'John Doe',
        email: 'john@example.com',
        password: 'SecurePass1',
      });

      expect(result.success).toBe(true);

      vi.unstubAllEnvs();
    });

    it('throws INTERNAL_SERVER when signUp fails in production', async () => {
      vi.stubEnv('NODE_ENV', 'production');

      mock.auth.signUp.mockResolvedValueOnce({
        data: {},
        error: { message: 'Server error' },
      });

      const result = await service.register({
        name: 'John Doe',
        email: 'john@example.com',
        password: 'SecurePass1',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');

      vi.unstubAllEnvs();
    });
  });

  describe('login', () => {
    it('returns user when credentials are valid', async () => {
      const mockUser = { id: 'user-1', email: 'john@example.com' };
      mock.auth.signInWithPassword.mockResolvedValueOnce({
        data: { user: mockUser, session: { access_token: 'token' } },
        error: null,
      });

      const result = await service.login({
        email: 'john@example.com',
        password: 'SecurePass1',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.user).toEqual(mockUser);
      }
    });

    it('throws UNAUTHORIZED when credentials are invalid', async () => {
      mock.auth.signInWithPassword.mockResolvedValueOnce({
        data: { user: null },
        error: { message: 'Invalid credentials' },
      });

      const result = await service.login({ email: 'john@example.com', password: 'wrong' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('UNAUTHORIZED');
    });

    it('throws INTERNAL_SERVER when user is null after successful login', async () => {
      mock.auth.signInWithPassword.mockResolvedValueOnce({
        data: { user: null },
        error: null,
      });

      const result = await service.login({ email: 'john@example.com', password: 'SecurePass1' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });
  });

  describe('logout', () => {
    it('calls signOut with local scope', async () => {
      mock.auth.signOut.mockResolvedValueOnce({ error: null });

      const result = await service.logout();

      expect(result.success).toBe(true);
      expect(mock.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    });

    it('throws INTERNAL_SERVER when signOut fails', async () => {
      mock.auth.signOut.mockResolvedValueOnce({ error: { message: 'error' } });

      const result = await service.logout();

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });
  });

  describe('requestPasswordReset', () => {
    it('calls resetPasswordForEmail', async () => {
      mock.auth.resetPasswordForEmail.mockResolvedValueOnce({ error: null });

      const result = await service.requestPasswordReset('john@example.com');

      expect(result.success).toBe(true);
    });

    it('throws BAD_REQUEST when reset fails', async () => {
      mock.auth.resetPasswordForEmail.mockResolvedValueOnce({
        error: { message: 'error' },
      });

      const result = await service.requestPasswordReset('john@example.com');

      expect(result.success).toBe(false);
      expect(result.error).toBe('BAD_REQUEST');
    });
  });

  describe('updatePassword', () => {
    it('calls updateUser with new password', async () => {
      mock.auth.updateUser.mockResolvedValueOnce({ error: null });

      const result = await service.updatePassword('NewSecure1');

      expect(result.success).toBe(true);
    });

    it('throws UNPROCESSABLE_ENTITY when same password', async () => {
      mock.auth.updateUser.mockResolvedValueOnce({
        error: { code: 'same_password' },
      });

      const result = await service.updatePassword('OldSecure1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('throws BAD_REQUEST when update fails with generic error', async () => {
      mock.auth.updateUser.mockResolvedValueOnce({
        error: { message: 'Generic error' },
      });

      const result = await service.updatePassword('NewSecure1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('BAD_REQUEST');
    });
  });
});
