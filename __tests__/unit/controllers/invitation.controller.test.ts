import { AccountType, type RequestContext } from '@studiq/authz';
import { InvitationController } from '@studiq/server/controllers/invitation.controller';
import type { ControllerResponse } from '@studiq/server/lib/controller-response';
import { failure, success } from '@studiq/server/lib/service-result';
import type { InvitationService } from '@studiq/server/services/invitation.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asService } from '#test/helpers/service-double';

type FailureResponse = Extract<ControllerResponse, { success: false }>;

/** One `createBulk` row, as the controller puts it in `data.results`. */
interface BulkInviteResponse {
  results: Array<{
    email: string;
    success: boolean;
    data: { success: boolean; invitationId: string; inviteLink: string };
  }>;
}

/**
 * The controller answers with a union. Tests assert the branch themselves first,
 * then read the payload through this view instead of casting the response to `any`.
 */
function envelope(response: ControllerResponse) {
  return response as {
    success: boolean;
    statusCode: number;
    data?: unknown;
    error?: FailureResponse['error'];
    details?: FailureResponse['details'];
  };
}

/** `createBulk` answers with one result per invitation. */
function isBulkInviteResponse(value: unknown): value is BulkInviteResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'results' in value &&
    Array.isArray(value.results)
  );
}

/** `createBulk` answers with one result per invitation. */
function bulkData(response: ControllerResponse): BulkInviteResponse {
  const data = envelope(response).data;
  if (!isBulkInviteResponse(data)) throw new Error('expected the bulk invitation payload');
  return data;
}

function createMockInvitationService() {
  return {
    createInvitation: vi.fn(),
    createInvitationsBulk: vi.fn(),
    getInvitationByToken: vi.fn(),
    acceptInvitation: vi.fn(),
    listInvitations: vi.fn(),
    updateInvitation: vi.fn(),
    deleteInvitation: vi.fn(),
  };
}

const mockCtx: RequestContext = {
  traceId: 'test-trace',
  userId: 'test-user-id',
  accountType: AccountType.STUDENT,
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
    controller = new InvitationController(asService<InvitationService>(mockService));
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
      expect(envelope(response).error).toBe('UNPROCESSABLE_ENTITY');
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

  describe('accept', () => {
    it('passes the trimmed token through and returns the joined organization', async () => {
      const data = { id: 'org-1', name: 'Test Org', orgRoleId: 'role-member' };
      mockService.acceptInvitation.mockResolvedValueOnce(success(data));

      const response = await controller.accept(mockCtx, { token: '  bare-code  ' });

      expect(response).toEqual({ success: true, statusCode: 200, data });
      expect(mockService.acceptInvitation).toHaveBeenCalledWith(mockCtx, 'bare-code');
    });

    // #317: the accept body used to be cast, so a non-string reached the service
    // (and the DB) unchecked. It is validated like every other request body.
    it.each([
      ['missing', {}],
      ['non-string', { token: 42 }],
      ['blank', { token: '   ' }],
    ])('returns 422 naming the token for a %s body', async (_label, body) => {
      const response = await controller.accept(mockCtx, body);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect(envelope(response).error).toBe('UNPROCESSABLE_ENTITY');
      expect((envelope(response).details ?? []).map((issue) => issue.path)).toContainEqual([
        'token',
      ]);
      expect(mockService.acceptInvitation).not.toHaveBeenCalled();
    });

    it('returns NOT_FOUND when the invitation is unknown', async () => {
      mockService.acceptInvitation.mockResolvedValueOnce(failure('NOT_FOUND'));

      const response = await controller.accept(mockCtx, { token: 'nope' });

      expect(response).toEqual({ success: false, statusCode: 404, error: 'NOT_FOUND' });
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
      expect(bulkData(response).results.length).toBe(2);
      expect(bulkData(response).results[0]?.data.invitationId).toBe('inv-1');
      // #313: the controller passes the copyable link through unchanged.
      expect(bulkData(response).results[0]?.data.inviteLink).toBe(
        'http://localhost:3000/join?token=token-1',
      );
      expect(bulkData(response).results[1]?.data.inviteLink).toBe(
        'http://localhost:3000/join?token=token-2',
      );
      // MGR-INV-02: every row is attributable to the address that was submitted.
      expect(bulkData(response).results.map((r) => r.email)).toEqual([
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
      expect(envelope(response).error).toBe('UNPROCESSABLE_ENTITY');
      expect((envelope(response).details ?? []).map((issue) => issue.path)).toContainEqual([
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
      expect(envelope(response).error).toBe('UNPROCESSABLE_ENTITY');
      expect(envelope(response).data).toBeUndefined();
      expect(envelope(response).details).toEqual([
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
      expect(envelope(response).data).toBeUndefined();
    });
  });

  describe('org.invitation.manage', () => {
    /** A role holding the key at organization scope (the Admin role). */
    const holderCtx: RequestContext = {
      ...mockCtx,
      accountType: AccountType.MANAGER,
      orgRoleId: 'role-admin',
      activeOrgId: 'org-1',
      permissionScopes: { 'org.invitation.manage': 'organization' },
    };
    /** The seeded Member role: in the org, no `org.*` key. */
    const memberCtx: RequestContext = {
      ...mockCtx,
      orgRoleId: 'role-member',
      activeOrgId: 'org-1',
    };

    it('lists invitations for a holder', async () => {
      const service = mockService;
      service.listInvitations.mockResolvedValueOnce(success([]));

      const response = await controller.list(holderCtx, { isAccepted: false });

      expect(response).toMatchObject({ success: true, statusCode: 200 });
      expect(service.listInvitations).toHaveBeenCalledWith(holderCtx, false);
    });

    it('updates and deletes for a holder', async () => {
      const service = mockService;
      service.updateInvitation.mockResolvedValueOnce(success(undefined));
      service.deleteInvitation.mockResolvedValueOnce(success(undefined));

      await expect(
        controller.update(holderCtx, 'inv-1', {
          targetOrgRoleId: '550e8400-e29b-41d4-a716-446655440001',
        }),
      ).resolves.toMatchObject({ success: true });
      await expect(controller.delete(holderCtx, 'inv-1')).resolves.toMatchObject({
        success: true,
      });

      expect(service.updateInvitation).toHaveBeenCalledTimes(1);
      expect(service.deleteInvitation).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['list', () => controller.list(memberCtx, {})],
      ['update', () => controller.update(memberCtx, 'inv-1', { targetOrgRoleId: 'not-a-uuid' })],
      ['delete', () => controller.delete(memberCtx, 'inv-1')],
    ])('refuses a Member-role caller on %s without reaching the service', async (_op, call) => {
      const service = mockService;

      await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
      expect(service.listInvitations).not.toHaveBeenCalled();
      expect(service.updateInvitation).not.toHaveBeenCalled();
      expect(service.deleteInvitation).not.toHaveBeenCalled();
    });

    it('refuses a caller with no active org', async () => {
      const service = mockService;

      await expect(controller.list({ ...memberCtx, activeOrgId: null })).rejects.toMatchObject({
        statusCode: 403,
      });
      expect(service.listInvitations).not.toHaveBeenCalled();
    });

    it('gates before the body is validated', async () => {
      const service = mockService;

      // The update schema would answer 422; a refused caller must see 403.
      await expect(controller.update(memberCtx, 'inv-1', {})).rejects.toMatchObject({
        statusCode: 403,
      });
      expect(service.updateInvitation).not.toHaveBeenCalled();
    });
  });
});
