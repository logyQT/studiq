import type { RequestContext } from '@studiq/authz';
import { InvitationController } from '@studiq/server/controllers/invitation.controller';
import { failure, success } from '@studiq/server/lib/service-result';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function createMockInvitationService() {
  return {
    createInvitation: vi.fn(),
    getInvitationByToken: vi.fn(),
  };
}

const mockCtx: RequestContext = {
  traceId: 'test-trace',
  userId: 'test-user-id',
  accountType: 'student',
  orgRoleId: null,
  activeOrgId: null,
  url: '/test',
  method: 'GET',
  groupIds: [],
  permissionScopes: {},
};

describe('InvitationController', () => {
  let mockService: ReturnType<typeof createMockInvitationService>;
  let controller: InvitationController;

  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockInvitationService();
    controller = new InvitationController(mockService as any);
  });

  describe('create', () => {
    it('returns success when invitation is created', async () => {
      const result = { success: true, inviteLink: 'http://example.com/join?token=abc' };
      mockService.createInvitation.mockResolvedValueOnce(success(result));

      const response = await controller.create(mockCtx, {
        email: 'john@example.com',
        targetOrgRoleId: '550e8400-e29b-41d4-a716-446655440000',
      });

      expect(response).toEqual({
        success: true,
        statusCode: 201,
        data: result,
      });
    });

    it('returns UNPROCESSABLE_ENTITY for invalid input', async () => {
      const response = await controller.create(mockCtx, {
        email: 'not-an-email',
        targetOrgRoleId: 'not-a-uuid',
      });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect((response as any).error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('returns NOT_FOUND when inviter profile not found', async () => {
      mockService.createInvitation.mockResolvedValueOnce(failure('NOT_FOUND'));

      const response = await controller.create(mockCtx, {
        email: 'john@example.com',
        targetOrgRoleId: '550e8400-e29b-41d4-a716-446655440000',
      });

      expect(response).toEqual({
        success: false,
        statusCode: 404,
        error: 'NOT_FOUND',
      });
    });

    it('returns FORBIDDEN when user lacks permissions', async () => {
      mockService.createInvitation.mockResolvedValueOnce(failure('FORBIDDEN'));

      const response = await controller.create(mockCtx, {
        email: 'john@example.com',
        targetOrgRoleId: '550e8400-e29b-41d4-a716-446655440000',
      });

      expect(response).toEqual({
        success: false,
        statusCode: 403,
        error: 'FORBIDDEN',
      });
    });
  });

  describe('getByToken', () => {
    it('returns invitation when found and valid', async () => {
      const invitation = { email: 'john@example.com', name: 'John Doe' };
      mockService.getInvitationByToken.mockResolvedValueOnce(success(invitation));

      const response = await controller.getByToken('valid-token');

      expect(response).toEqual({
        success: true,
        statusCode: 200,
        data: invitation,
      });
    });

    it('returns NOT_FOUND when token does not exist', async () => {
      mockService.getInvitationByToken.mockResolvedValueOnce(failure('NOT_FOUND'));

      const response = await controller.getByToken('invalid-token');

      expect(response).toEqual({
        success: false,
        statusCode: 404,
        error: 'NOT_FOUND',
      });
    });

    it('returns GONE when token is expired', async () => {
      mockService.getInvitationByToken.mockResolvedValueOnce(failure('GONE'));

      const response = await controller.getByToken('expired-token');

      expect(response).toEqual({
        success: false,
        statusCode: 410,
        error: 'GONE',
      });
    });

    it('returns BAD_REQUEST when token is empty', async () => {
      const response = await controller.getByToken('');

      expect(response).toEqual({
        success: false,
        statusCode: 400,
        error: 'BAD_REQUEST',
      });
    });
  });

  describe('createBulk', () => {
    it('returns results for each invitation', async () => {
      mockService.createInvitation.mockResolvedValue(success({ inviteLink: undefined }));

      const response = await controller.createBulk(mockCtx, {
        invitations: [
          { email: 'john@example.com', targetOrgRoleId: '550e8400-e29b-41d4-a716-446655440001' },
          { email: 'jane@example.com', targetOrgRoleId: '550e8400-e29b-41d4-a716-446655440002' },
        ],
      });

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
      expect((response as any).data).toHaveProperty('results');
      expect((response as any).data.results.length).toBe(2);
    });

    it('returns UNPROCESSABLE_ENTITY for invalid bulk input', async () => {
      const response = await controller.createBulk(mockCtx, { invitations: [] });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });

    it('handles service failures gracefully during bulk', async () => {
      mockService.createInvitation.mockResolvedValueOnce(failure('INTERNAL_SERVER'));

      const response = await controller.createBulk(mockCtx, {
        invitations: [
          { email: 'john@example.com', targetOrgRoleId: '550e8400-e29b-41d4-a716-446655440001' },
        ],
      });

      expect(response.success).toBe(true);
      expect((response as any).data.results[0].success).toBe(false);
    });
  });
});
