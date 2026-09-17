import { RequestContext } from '@studiq/authz';
import { OrganizationMemberController } from '@studiq/server/controllers/organization-member.controller';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@studiq/server/lib/features', () => ({
  requireFeature: vi.fn().mockResolvedValue(undefined),
}));

function createMockService() {
  return {
    listMembers: vi.fn(),
    changeRole: vi.fn(),
    removeMember: vi.fn(),
  };
}

let mockService: ReturnType<typeof createMockService>;
let controller: OrganizationMemberController;
const mockCtx: RequestContext = {
  traceId: 'test',
  userId: 'u-1',
  accountType: 'educator' as any,
  orgRoleId: null,
  activeOrgId: 'org-1',
  url: '',
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
      mockService.listMembers.mockResolvedValueOnce({ success: true, data: [] });
      const response = await controller.listMembers(mockCtx);
      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
    });
    it('returns members with role filter', async () => {
      mockService.listMembers.mockResolvedValueOnce({ success: true, data: [] });
      await controller.listMembers(mockCtx, 'teacher');
      expect(mockService.listMembers).toHaveBeenCalledWith(mockCtx, 'teacher');
    });
    it('returns error on failure', async () => {
      mockService.listMembers.mockResolvedValueOnce({ success: false, error: 'FORBIDDEN' });
      const response = await controller.listMembers(mockCtx);
      expect(response.success).toBe(false);
    });
  });

  describe('changeRole', () => {
    it('changes role', async () => {
      mockService.changeRole.mockResolvedValueOnce({ success: true, data: undefined });
      const response = await controller.changeRole(mockCtx, {
        targetUserId: '550e8400-e29b-41d4-a716-446655440000',
        newOrgRoleId: '550e8400-e29b-41d4-a716-446655440001',
      });
      expect(response.success).toBe(true);
    });
    it('returns 422 on invalid body', async () => {
      const response = await controller.changeRole(mockCtx, { targetUserId: 'bad' });
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });
  });

  describe('removeMember', () => {
    it('removes a member', async () => {
      mockService.removeMember.mockResolvedValueOnce({ success: true, data: undefined });
      const response = await controller.removeMember(
        mockCtx,
        '550e8400-e29b-41d4-a716-446655440000',
      );
      expect(response.success).toBe(true);
    });
    it('returns 400 when targetUserId is empty', async () => {
      const response = await controller.removeMember(mockCtx, '');
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(400);
    });
    it('returns error on failure', async () => {
      mockService.removeMember.mockResolvedValueOnce({ success: false, error: 'FORBIDDEN' });
      const response = await controller.removeMember(
        mockCtx,
        '550e8400-e29b-41d4-a716-446655440000',
      );
      expect(response.success).toBe(false);
    });
  });
});
