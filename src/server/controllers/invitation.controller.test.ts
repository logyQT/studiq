import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invitationController } from './invitation.controller';
import { invitationService } from '@/server/services';
import { AppError } from '@/lib/errors';

vi.mock('@/server/services', () => ({
  invitationService: {
    createInvitation: vi.fn(),
    getInvitationByToken: vi.fn(),
    createInvitationBulk: vi.fn(),
  },
}));

const mockService = vi.mocked(invitationService);

describe('InvitationController', () => {
  const userId = 'test-user-id';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('returns success when invitation is created', async () => {
      const result = { success: true, inviteLink: 'http://example.com/join?token=abc' };
      mockService.createInvitation.mockResolvedValueOnce(result);

      const response = await invitationController.create(userId, {
        name: 'John Doe',
        email: 'john@example.com',
        role: 'student',
      });

      expect(response).toEqual({
        success: true,
        statusCode: 201,
        data: result,
      });
    });

    it('returns UNPROCESSABLE_ENTITY for invalid input', async () => {
      const response = await invitationController.create(userId, {
        name: '',
        email: 'bad',
        role: 'invalid',
      });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect((response as any).error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('returns NOT_FOUND when inviter profile not found', async () => {
      mockService.createInvitation.mockRejectedValueOnce(new AppError('NOT_FOUND'));

      const response = await invitationController.create(userId, {
        name: 'John Doe',
        email: 'john@example.com',
        role: 'student',
      });

      expect(response).toEqual({
        success: false,
        statusCode: 404,
        error: 'NOT_FOUND',
      });
    });

    it('returns FORBIDDEN when user lacks permissions', async () => {
      mockService.createInvitation.mockRejectedValueOnce(new AppError('FORBIDDEN'));

      const response = await invitationController.create(userId, {
        name: 'John Doe',
        email: 'john@example.com',
        role: 'student',
      });

      expect(response).toEqual({
        success: false,
        statusCode: 403,
        error: 'FORBIDDEN',
      });
    });

    it('returns INTERNAL_SERVER when service throws generic error', async () => {
      mockService.createInvitation.mockRejectedValueOnce(new Error('unexpected'));

      const response = await invitationController.create(userId, {
        name: 'John Doe',
        email: 'john@example.com',
        role: 'student',
      });

      expect(response).toEqual({
        success: false,
        statusCode: 500,
        error: 'INTERNAL_SERVER',
      });
    });
  });

  describe('getByToken', () => {
    it('returns invitation when found and valid', async () => {
      const invitation = { email: 'john@example.com', name: 'John Doe' };
      mockService.getInvitationByToken.mockResolvedValueOnce(invitation);

      const response = await invitationController.getByToken('valid-token');

      expect(response).toEqual({
        success: true,
        statusCode: 200,
        data: invitation,
      });
    });

    it('returns NOT_FOUND when token does not exist', async () => {
      mockService.getInvitationByToken.mockRejectedValueOnce(new AppError('NOT_FOUND'));

      const response = await invitationController.getByToken('invalid-token');

      expect(response).toEqual({
        success: false,
        statusCode: 404,
        error: 'NOT_FOUND',
      });
    });

    it('returns GONE when token is expired', async () => {
      mockService.getInvitationByToken.mockRejectedValueOnce(new AppError('GONE'));

      const response = await invitationController.getByToken('expired-token');

      expect(response).toEqual({
        success: false,
        statusCode: 410,
        error: 'GONE',
      });
    });

    it('returns BAD_REQUEST when token is empty', async () => {
      const response = await invitationController.getByToken('');

      expect(response).toEqual({
        success: false,
        statusCode: 400,
        error: 'BAD_REQUEST',
      });
    });

    it('returns INTERNAL_SERVER when service throws generic error', async () => {
      mockService.getInvitationByToken.mockRejectedValueOnce(new Error('unexpected'));

      const response = await invitationController.getByToken('valid-token');

      expect(response).toEqual({
        success: false,
        statusCode: 500,
        error: 'INTERNAL_SERVER',
      });
    });
  });

  describe('createBulk', () => {
    it('returns results for each invitation', async () => {
      mockService.createInvitation.mockResolvedValue({ success: true, inviteLink: undefined });

      const response = await invitationController.createBulk(userId, {
        invitations: [
          { name: 'John', email: 'john@example.com', role: 'student' },
          { name: 'Jane', email: 'jane@example.com', role: 'teacher' },
        ],
      });

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
      expect((response as any).data).toHaveProperty('results');
      expect((response as any).data.results.length).toBe(2);
    });

    it('returns UNPROCESSABLE_ENTITY for invalid bulk input', async () => {
      const response = await invitationController.createBulk(userId, { invitations: [] });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });

    it('returns INTERNAL_SERVER when service throws generic error during bulk', async () => {
      mockService.createInvitation.mockRejectedValueOnce(new Error('unexpected'));

      const response = await invitationController.createBulk(userId, {
        invitations: [{ name: 'John', email: 'john@example.com', role: 'student' }],
      });

      expect(response.success).toBe(true);
      expect((response as any).data.results[0].success).toBe(false);
    });
  });
});
