import { AuthController } from '@studiq/server/controllers/auth.controller';
import { failure, success } from '@studiq/server/lib/service-result';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function createMockAuthService() {
  return {
    register: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    requestPasswordReset: vi.fn(),
    updateProfile: vi.fn(),
    updatePassword: vi.fn(),
  };
}

describe('AuthController', () => {
  let mockService: ReturnType<typeof createMockAuthService>;
  let controller: AuthController;

  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockAuthService();
    controller = new AuthController(mockService as any);
  });

  describe('register', () => {
    it('returns success when registration succeeds', async () => {
      mockService.register.mockResolvedValueOnce(success(undefined));

      const response = await controller.register({
        name: 'John Doe',
        email: 'john@example.com',
        password: 'SecurePass1',
        accountType: 'student',
      });

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(202);
      expect((response as any).data).toEqual({ message: 'SUCCESS_ACTIVATION_LINK_SENT' });
    });

    it('returns UNPROCESSABLE_ENTITY for invalid input', async () => {
      const response = await controller.register({ name: '', email: 'bad', password: 'x' });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect((response as any).error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('returns error when service returns failure', async () => {
      mockService.register.mockResolvedValueOnce(failure('INTERNAL_SERVER'));

      const response = await controller.register({
        name: 'John Doe',
        email: 'john@example.com',
        password: 'SecurePass1',
        accountType: 'student',
      });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(500);
      expect((response as any).error).toBe('INTERNAL_SERVER');
    });

    // #311: an invite token that died between the /join preview and submit maps
    // to 410 so the client can tell the invitee the link is no longer usable.
    it('maps a GONE invite token to 410', async () => {
      mockService.register.mockResolvedValueOnce(failure('GONE'));

      const response = await controller.register({
        name: 'John Doe',
        email: 'john@example.com',
        password: 'SecurePass1',
        accountType: 'student',
        inviteToken: 'dead-token',
      });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(410);
      expect((response as any).error).toBe('GONE');
    });
  });

  describe('login', () => {
    const mockSession = { access_token: 'token', refresh_token: 'refresh' };
    const mockUser = { id: 'user-1', email: 'john@example.com' };

    it('returns user when login succeeds', async () => {
      mockService.login.mockResolvedValueOnce(
        success({ user: mockUser as any, session: mockSession as any }),
      );

      const response = await controller.login({
        email: 'john@example.com',
        password: 'SecurePass1',
      });

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
      expect((response as any).data).toEqual({ user: mockUser, session: mockSession });
    });

    it('returns UNPROCESSABLE_ENTITY for invalid input', async () => {
      const response = await controller.login({ email: 'bad', password: '' });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect((response as any).error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('returns error when service returns failure', async () => {
      mockService.login.mockResolvedValueOnce(failure('UNAUTHORIZED'));

      const response = await controller.login({
        email: 'john@example.com',
        password: 'wrong',
      });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(401);
      expect((response as any).error).toBe('UNAUTHORIZED');
    });
  });

  describe('logout', () => {
    it('returns success when logout succeeds', async () => {
      mockService.logout.mockResolvedValueOnce(success(undefined));

      const response = await controller.logout();

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
    });

    it('returns error when service returns failure', async () => {
      mockService.logout.mockResolvedValueOnce(failure('INTERNAL_SERVER'));

      const response = await controller.logout();

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(500);
    });
  });

  describe('requestPasswordReset', () => {
    it('returns success when reset email sent', async () => {
      mockService.requestPasswordReset.mockResolvedValueOnce(success(undefined));

      const response = await controller.requestPasswordReset({ email: 'john@example.com' });

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
    });

    it('returns UNPROCESSABLE_ENTITY for invalid email', async () => {
      const response = await controller.requestPasswordReset({ email: 'bad' });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });

    it('returns error when service returns failure', async () => {
      mockService.requestPasswordReset.mockResolvedValueOnce(failure('BAD_REQUEST'));

      const response = await controller.requestPasswordReset({ email: 'john@example.com' });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(400);
    });
  });

  describe('updatePassword', () => {
    it('returns success when password updated', async () => {
      mockService.updatePassword.mockResolvedValueOnce(success(undefined));

      const response = await controller.updatePassword({
        password: 'NewSecure1',
        confirmPassword: 'NewSecure1',
      });

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
    });

    it('forwards currentPassword to the service', async () => {
      mockService.updatePassword.mockResolvedValueOnce(success(undefined));

      await controller.updatePassword({
        currentPassword: 'pass',
        password: 'NewSecure1',
        confirmPassword: 'NewSecure1',
      });

      expect(mockService.updatePassword).toHaveBeenCalledWith({
        currentPassword: 'pass',
        password: 'NewSecure1',
      });
    });

    it('returns UNPROCESSABLE_ENTITY when currentPassword is empty', async () => {
      const response = await controller.updatePassword({
        currentPassword: '',
        password: 'NewSecure1',
        confirmPassword: 'NewSecure1',
      });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect(mockService.updatePassword).not.toHaveBeenCalled();
    });

    it('returns UNPROCESSABLE_ENTITY when passwords do not match', async () => {
      const response = await controller.updatePassword({
        password: 'NewSecure1',
        confirmPassword: 'Different1',
      });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });

    it('returns 400 INVALID_CURRENT_PASSWORD when the current password is wrong', async () => {
      mockService.updatePassword.mockResolvedValueOnce(failure('INVALID_CURRENT_PASSWORD'));

      const response = await controller.updatePassword({
        currentPassword: 'WrongPass1',
        password: 'NewSecure1',
        confirmPassword: 'NewSecure1',
      });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(400);
      expect((response as any).error).toBe('INVALID_CURRENT_PASSWORD');
    });

    it('returns UNPROCESSABLE_ENTITY when service returns same_password', async () => {
      mockService.updatePassword.mockResolvedValueOnce(failure('UNPROCESSABLE_ENTITY'));

      const response = await controller.updatePassword({
        password: 'OldSecure1',
        confirmPassword: 'OldSecure1',
      });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });
  });
});
