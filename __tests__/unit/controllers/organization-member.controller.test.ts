import { AccountType, type RequestContext } from '@studiq/authz';
import { OrganizationMemberController } from '@studiq/server/controllers/organization-member.controller';
import { OrganizationMemberService } from '@studiq/server/services/organization-member.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** A context whose role holds `org.member.manage` at organization scope. */
const holderCtx: RequestContext = {
  traceId: 'test',
  userId: 'u-1',
  accountType: AccountType.EDUCATOR,
  orgRoleId: 'role-admin',
  activeOrgId: 'org-1',
  url: '',
  method: 'GET',
  groupIds: [],
  permissionScopes: { 'org.member.manage': 'organization' },
};

/** The seeded Member role: in the org, no `org.*` key. */
const memberCtx: RequestContext = {
  ...holderCtx,
  accountType: AccountType.STUDENT,
  orgRoleId: 'role-member',
  permissionScopes: {},
};

/** A cookie that names an org with no membership row: with-auth leaves both null. */
const noOrgCtx: RequestContext = {
  ...holderCtx,
  activeOrgId: null,
  orgRoleId: null,
  permissionScopes: {},
};

function createMockService() {
  // The mocked methods never touch the database, so the client factory only
  // has to satisfy the constructor's type.
  return Object.assign(new OrganizationMemberService(() => Promise.reject(new Error('unused'))), {
    listMembers: vi.fn(),
    changeRole: vi.fn(),
    removeMember: vi.fn(),
  });
}

let mockService: ReturnType<typeof createMockService>;
let controller: OrganizationMemberController;

describe('OrganizationMemberController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockService();
    controller = new OrganizationMemberController(mockService);
  });

  describe('listMembers', () => {
    it('returns members', async () => {
      mockService.listMembers.mockResolvedValueOnce({ success: true, data: [] });
      const response = await controller.listMembers(holderCtx);
      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
    });
    it('returns members with role filter', async () => {
      mockService.listMembers.mockResolvedValueOnce({ success: true, data: [] });
      await controller.listMembers(holderCtx, 'teacher');
      expect(mockService.listMembers).toHaveBeenCalledWith(holderCtx, 'teacher');
    });
    it('returns error on failure', async () => {
      mockService.listMembers.mockResolvedValueOnce({ success: false, error: 'FORBIDDEN' });
      const response = await controller.listMembers(holderCtx);
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(403);
    });

    it('refuses a Member-role caller without reaching the service', async () => {
      await expect(controller.listMembers(memberCtx)).rejects.toMatchObject({
        code: 'FORBIDDEN',
        statusCode: 403,
      });
      expect(mockService.listMembers).not.toHaveBeenCalled();
    });

    it('refuses a caller with no active org', async () => {
      await expect(controller.listMembers(noOrgCtx)).rejects.toMatchObject({ statusCode: 403 });
      expect(mockService.listMembers).not.toHaveBeenCalled();
    });
  });

  describe('changeRole', () => {
    it('changes role', async () => {
      mockService.changeRole.mockResolvedValueOnce({ success: true, data: undefined });
      const response = await controller.changeRole(holderCtx, {
        targetUserId: '550e8400-e29b-41d4-a716-446655440000',
        newOrgRoleId: '550e8400-e29b-41d4-a716-446655440001',
      });
      expect(response.success).toBe(true);
    });
    it('returns 422 on invalid body', async () => {
      const response = await controller.changeRole(holderCtx, { targetUserId: 'bad' });
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });

    // The gate runs before the schema: a caller without the key is not told
    // which field of a payload they were never allowed to send is wrong.
    it('answers 403 rather than 422 for an invalid body when the key is missing', async () => {
      await expect(
        controller.changeRole(memberCtx, { targetUserId: 'bad', newOrgRoleId: 'bad' }),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(mockService.changeRole).not.toHaveBeenCalled();
    });
  });

  describe('removeMember', () => {
    it('removes a member', async () => {
      mockService.removeMember.mockResolvedValueOnce({ success: true, data: undefined });
      const response = await controller.removeMember(
        holderCtx,
        '550e8400-e29b-41d4-a716-446655440000',
      );
      expect(response.success).toBe(true);
    });
    it('returns 400 when targetUserId is empty', async () => {
      const response = await controller.removeMember(holderCtx, '');
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(400);
    });
    it('returns error on failure', async () => {
      mockService.removeMember.mockResolvedValueOnce({ success: false, error: 'FORBIDDEN' });
      const response = await controller.removeMember(
        holderCtx,
        '550e8400-e29b-41d4-a716-446655440000',
      );
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(403);
    });

    it('answers 403 rather than 400 for an empty target when the key is missing', async () => {
      await expect(controller.removeMember(memberCtx, '')).rejects.toMatchObject({
        statusCode: 403,
      });
      expect(mockService.removeMember).not.toHaveBeenCalled();
    });
  });
});
