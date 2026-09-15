import { RequestContext } from '@studiq/authz';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrgController } from '@/server/controllers/org.controller';

function createMockService() {
  return { listOrgs: vi.fn(), verifyMembership: vi.fn() };
}

let mockService: ReturnType<typeof createMockService>;
let controller: OrgController;
const mockCtx: RequestContext = {
  traceId: 'test',
  userId: 'u-1',
  accountType: 'student' as any,
  orgRoleId: null,
  activeOrgId: null,
  url: '',
  method: 'GET',
  groupIds: [],
  permissionScopes: {},
};

describe('OrgController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockService();
    controller = new OrgController(mockService as any);
  });

  describe('listOrgs', () => {
    it('returns orgs', async () => {
      mockService.listOrgs.mockResolvedValueOnce({ success: true, data: [] });
      const response = await controller.listOrgs(mockCtx);
      expect(response.success).toBe(true);
    });
    it('returns error on failure', async () => {
      mockService.listOrgs.mockResolvedValueOnce({ success: false, error: 'INTERNAL_SERVER' });
      const response = await controller.listOrgs(mockCtx);
      expect(response.success).toBe(false);
    });
  });

  describe('switchOrg', () => {
    it('switches org successfully', async () => {
      mockService.verifyMembership.mockResolvedValueOnce({
        success: true,
        data: { organization_id: 'org-1' },
      });
      const response = await controller.switchOrg(mockCtx, {
        orgId: '550e8400-e29b-41d4-a716-446655440000',
      });
      expect(response.success).toBe(true);
      expect((response as any).data.orgId).toBe('550e8400-e29b-41d4-a716-446655440000');
    });
    it('returns 422 on invalid body', async () => {
      const response = await controller.switchOrg(mockCtx, { orgId: 'not-a-uuid' });
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });
    it('returns error when not a member', async () => {
      mockService.verifyMembership.mockResolvedValueOnce({ success: false, error: 'NOT_FOUND' });
      const response = await controller.switchOrg(mockCtx, {
        orgId: '550e8400-e29b-41d4-a716-446655440000',
      });
      expect(response.success).toBe(false);
    });
  });
});
