import { RequestContext } from '@studiq/authz';
import { OrganizationMemberController } from '@studiq/server/controllers/organization-member.controller';
import { failure, success } from '@studiq/server/lib/service-result';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/features', () => ({
  requireFeature: vi.fn().mockResolvedValue(undefined),
  getEnabledFeatures: vi.fn().mockResolvedValue([]),
}));

function createMockService() {
  return { listMembers: vi.fn(), changeRole: vi.fn(), removeMember: vi.fn() };
}

let mockService: ReturnType<typeof createMockService>;
let controller: OrganizationMemberController;

const mockCtx: RequestContext = {
  traceId: 'test-trace',
  userId: 'test-user-id',
  accountType: 'student' as any,
  orgRoleId: null,
  activeOrgId: null,
  url: 'http://localhost',
  method: 'GET',
  groupIds: [],
  permissionScopes: {},
};

describe('OrganizationMemberController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockService();
    controller = new OrganizationMemberController(mockService as any);
  });

  describe('listMembers', () => {
    it('returns members', async () => {
      const members = [{ id: 'user-1', account_type: 'student' }];
      mockService.listMembers.mockResolvedValueOnce(success(members));

      const response = await controller.listMembers(mockCtx);

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
      expect((response as any).data).toEqual(members);
    });

    it('passes roleFilter to service', async () => {
      mockService.listMembers.mockResolvedValueOnce(success([]));

      await controller.listMembers(mockCtx, 'student');

      expect(mockService.listMembers).toHaveBeenCalledWith(mockCtx, 'student');
    });

    it('returns error when service returns failure', async () => {
      mockService.listMembers.mockResolvedValueOnce(failure('INTERNAL_SERVER'));

      const response = await controller.listMembers(mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(500);
      expect((response as any).error).toBe('INTERNAL_SERVER');
    });
  });

  const validUserId = '550e8400-e29b-41d4-a716-446655440001';

  describe('changeRole', () => {
    it('returns success when service changes role successfully', async () => {
      const body = {
        targetUserId: validUserId,
        newOrgRoleId: '00000000-0000-4000-8000-000000000001',
      };
      mockService.changeRole.mockResolvedValueOnce(success(undefined));

      const response = await controller.changeRole(mockCtx, body);

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
      expect((response as any).data).toEqual({ success: true });
    });

    it('returns UNPROCESSABLE_ENTITY when body fails validation', async () => {
      const response = await controller.changeRole(mockCtx, {
        targetUserId: '',
        newOrgRoleId: 'invalid',
      });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect((response as any).error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('returns error when service returns failure', async () => {
      mockService.changeRole.mockResolvedValueOnce(failure('FORBIDDEN'));

      const response = await controller.changeRole(mockCtx, {
        targetUserId: validUserId,
        newOrgRoleId: '00000000-0000-4000-8000-000000000001',
      });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(403);
      expect((response as any).error).toBe('FORBIDDEN');
    });

    it('returns error when service returns failure', async () => {
      mockService.changeRole.mockResolvedValueOnce(failure('INTERNAL_SERVER'));

      const response = await controller.changeRole(mockCtx, {
        targetUserId: validUserId,
        newOrgRoleId: '00000000-0000-4000-8000-000000000001',
      });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(500);
      expect((response as any).error).toBe('INTERNAL_SERVER');
    });
  });

  describe('removeMember', () => {
    it('returns success when service removes member successfully', async () => {
      mockService.removeMember.mockResolvedValueOnce(success(undefined));

      const response = await controller.removeMember(mockCtx, 'user-123');

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
      expect((response as any).data).toEqual({ success: true });
    });

    it('returns BAD_REQUEST when targetUserId is empty', async () => {
      const response = await controller.removeMember(mockCtx, '');

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(400);
      expect((response as any).error).toBe('BAD_REQUEST');
    });

    it('returns error when service returns failure', async () => {
      mockService.removeMember.mockResolvedValueOnce(failure('FORBIDDEN'));

      const response = await controller.removeMember(mockCtx, 'user-123');

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(403);
      expect((response as any).error).toBe('FORBIDDEN');
    });

    it('returns error when service returns failure', async () => {
      mockService.removeMember.mockResolvedValueOnce(failure('INTERNAL_SERVER'));

      const response = await controller.removeMember(mockCtx, 'user-123');

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(500);
      expect((response as any).error).toBe('INTERNAL_SERVER');
    });
  });
});
