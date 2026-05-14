import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authController } from './auth.controller';
import { authService } from '@/server/services';
import { AppError } from '@/lib/errors';

vi.mock('@/server/services', () => ({
  authService: {
    register: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    requestPasswordReset: vi.fn(),
    updatePassword: vi.fn(),
  },
}));

const mockService = vi.mocked(authService);

describe('AuthController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('register', () => {
    it('returns success when registration succeeds', async () => {
      mockService.register.mockResolvedValueOnce(undefined);

      const response = await authController.register({
        name: 'John Doe',
        email: 'john@example.com',
        password: 'SecurePass1',
      });

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(202);
      expect((response as any).data).toEqual({ message: 'SUCCESS_ACTIVATION_LINK_SENT' });
    });

    it('returns UNPROCESSABLE_ENTITY for invalid input', async () => {
      const response = await authController.register({ name: '', email: 'bad', password: 'x' });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect((response as any).error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('returns INTERNAL_SERVER when service throws', async () => {
      mockService.register.mockRejectedValueOnce(new AppError('INTERNAL_SERVER'));

      const response = await authController.register({
        name: 'John Doe',
        email: 'john@example.com',
        password: 'SecurePass1',
      });

      expect(response).toEqual({
        success: false,
        statusCode: 500,
        error: 'INTERNAL_SERVER',
      });
    });
  });

  describe('login', () => {
    it('returns user when login succeeds', async () => {
      const mockUser = { id: 'user-1', email: 'john@example.com' };
      mockService.login.mockResolvedValueOnce({ user: mockUser as any });

      const response = await authController.login({
        email: 'john@example.com',
        password: 'SecurePass1',
      });

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
      expect((response as any).data).toEqual({ user: mockUser });
    });

    it('returns UNPROCESSABLE_ENTITY for invalid input', async () => {
      const response = await authController.login({ email: 'bad', password: '' });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect((response as any).error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('returns error when service throws', async () => {
      mockService.login.mockRejectedValueOnce(new AppError('UNAUTHORIZED'));

      const response = await authController.login({
        email: 'john@example.com',
        password: 'wrong',
      });

      expect(response).toEqual({
        success: false,
        statusCode: 401,
        error: 'UNAUTHORIZED',
      });
    });
  });

  describe('logout', () => {
    it('returns success when logout succeeds', async () => {
      mockService.logout.mockResolvedValueOnce(undefined);

      const response = await authController.logout();

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
    });

    it('returns error when service throws', async () => {
      mockService.logout.mockRejectedValueOnce(new AppError('INTERNAL_SERVER'));

      const response = await authController.logout();

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(500);
    });
  });

  describe('requestPasswordReset', () => {
    it('returns success when reset email sent', async () => {
      mockService.requestPasswordReset.mockResolvedValueOnce(undefined);

      const response = await authController.requestPasswordReset({ email: 'john@example.com' });

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
    });

    it('returns UNPROCESSABLE_ENTITY for invalid email', async () => {
      const response = await authController.requestPasswordReset({ email: 'bad' });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });
  });

  describe('updatePassword', () => {
    it('returns success when password updated', async () => {
      mockService.updatePassword.mockResolvedValueOnce(undefined);

      const response = await authController.updatePassword({
        password: 'NewSecure1',
        confirmPassword: 'NewSecure1',
      });

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
    });

    it('returns UNPROCESSABLE_ENTITY when passwords do not match', async () => {
      const response = await authController.updatePassword({
        password: 'NewSecure1',
        confirmPassword: 'Different1',
      });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });

    it('returns UNPROCESSABLE_ENTITY when service throws same_password', async () => {
      mockService.updatePassword.mockRejectedValueOnce(new AppError('UNPROCESSABLE_ENTITY'));

      const response = await authController.updatePassword({
        password: 'OldSecure1',
        confirmPassword: 'OldSecure1',
      });

      expect(response).toEqual({
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
      });
    });
  });
});
