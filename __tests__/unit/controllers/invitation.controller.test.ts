import type { RequestContext } from '@studiq/authz';
import { InvitationController } from '@studiq/server/controllers/invitation.controller';
import { failure, success } from '@studiq/server/lib/service-result';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function createMockInvitationService() {
  return {
    createInvitation: vi.fn(),
    createInvitationsBulk: vi.fn(),
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
    it('returns one result per invitation', async () => {
      mockService.createInvitationsBulk.mockResolvedValueOnce(
        success([
          {
            email: 'john@example.com',
            success: true,
            data: {
              success: true,
              invitationId: 'inv-1',
              inviteLink: 'http://localhost:3000/join?token=token-1',
            },
          },
          {
            email: 'jane@example.com',
            success: true,
            data: {
              success: true,
              invitationId: 'inv-2',
              inviteLink: 'http://localhost:3000/join?token=token-2',
            },
          },
        ]),
      );

      const response = await controller.createBulk(mockCtx, {
        invitations: [
          { email: 'john@example.com', targetOrgRoleId: '550e8400-e29b-41d4-a716-446655440001' },
          { email: 'jane@example.com', targetOrgRoleId: '550e8400-e29b-41d4-a716-446655440002' },
        ],
      });

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
      expect((response as any).data.results.length).toBe(2);
      expect((response as any).data.results[0].data.invitationId).toBe('inv-1');
      // #313: the controller passes the copyable link through unchanged.
      expect((response as any).data.results[0].data.inviteLink).toBe(
        'http://localhost:3000/join?token=token-1',
      );
      expect((response as any).data.results[1].data.inviteLink).toBe(
        'http://localhost:3000/join?token=token-2',
      );
      // MGR-INV-02: every row is attributable to the address that was submitted.
      expect((response as any).data.results.map((r: any) => r.email)).toEqual([
        'john@example.com',
        'jane@example.com',
      ]);
    });

    it('returns UNPROCESSABLE_ENTITY naming the incomplete entry', async () => {
      const response = await controller.createBulk(mockCtx, {
        invitations: [{ email: 'john@example.com' }],
      });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect((response as any).error).toBe('UNPROCESSABLE_ENTITY');
      expect(((response as any).details ?? []).map((issue: any) => issue.path)).toContainEqual([
        'invitations',
        0,
        'targetOrgRoleId',
      ]);
      // The schema rejected the batch before the service was called.
      expect(mockService.createInvitationsBulk).not.toHaveBeenCalled();
    });

    it('rejects the whole batch instead of answering a partial success', async () => {
      mockService.createInvitationsBulk.mockResolvedValueOnce(
        failure('UNPROCESSABLE_ENTITY', [
          {
            code: 'custom',
            message: 'VALIDATION_INVALID_ROLE',
            path: ['invitations', 1, 'targetOrgRoleId'],
          },
        ]),
      );

      const response = await controller.createBulk(mockCtx, {
        invitations: [
          { email: 'john@example.com', targetOrgRoleId: '550e8400-e29b-41d4-a716-446655440001' },
          { email: 'jane@example.com', targetOrgRoleId: '550e8400-e29b-41d4-a716-446655440002' },
        ],
      });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect((response as any).error).toBe('UNPROCESSABLE_ENTITY');
      expect((response as any).data).toBeUndefined();
      expect((response as any).details).toEqual([
        expect.objectContaining({ path: ['invitations', 1, 'targetOrgRoleId'] }),
      ]);
    });

    it('returns a non-200 when the service fails', async () => {
      mockService.createInvitationsBulk.mockResolvedValueOnce(failure('INTERNAL_SERVER'));

      const response = await controller.createBulk(mockCtx, {
        invitations: [
          { email: 'john@example.com', targetOrgRoleId: '550e8400-e29b-41d4-a716-446655440001' },
        ],
      });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(500);
      expect((response as any).data).toBeUndefined();
    });
  });
});
