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

/** A Teacher's roster-relevant keys sit at `group` scope (D18). */
const groupManagerCtx: RequestContext = {
  ...holderCtx,
  accountType: AccountType.EDUCATOR,
  orgRoleId: 'role-teacher',
  permissionScopes: { 'group.manage': 'group' },
};

const groupInviterCtx: RequestContext = {
  ...groupManagerCtx,
  permissionScopes: { 'group.invite': 'group' },
};

/**
 * The shipped Billing preset: `org.billing.manage` + `org.seat.manage` and
 * nothing else, yet `/manage/seats` fills its assign dialog from this endpoint.
 */
const seatManagerCtx: RequestContext = {
  ...holderCtx,
  accountType: AccountType.MANAGER,
  orgRoleId: 'role-billing',
  permissionScopes: { 'org.billing.manage': 'organization', 'org.seat.manage': 'organization' },
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
    // D25: the roster has four read authorities — its own key, a class
    // manager's, a class inviter's and the seat manager's. Each row pins one
    // branch on a caller that holds nothing else, so dropping a branch cannot
    // pass on another.
    it('reads the roster for an org.member.manage holder', async () => {
      mockService.listMembers.mockResolvedValueOnce({
        success: true,
        data: [{ id: 'u-2', email: 'member@example.com' }],
      });
      const response = await controller.listMembers(holderCtx);
      expect(response.statusCode).toBe(200);
      expect(response.data).toEqual([{ id: 'u-2', email: 'member@example.com' }]);
    });
    it('reads the roster for a group.manage-only holder', async () => {
      mockService.listMembers.mockResolvedValueOnce({ success: true, data: [{ id: 'u-2' }] });
      const response = await controller.listMembers(groupManagerCtx);
      expect(response.statusCode).toBe(200);
      expect(response.data).toEqual([{ id: 'u-2' }]);
    });
    it('reads the roster for a group.invite-only holder', async () => {
      mockService.listMembers.mockResolvedValueOnce({ success: true, data: [{ id: 'u-2' }] });
      const response = await controller.listMembers(groupInviterCtx);
      expect(response.statusCode).toBe(200);
      expect(response.data).toEqual([{ id: 'u-2' }]);
    });
    it('reads the roster for an org.seat.manage-only holder (the Billing preset)', async () => {
      mockService.listMembers.mockResolvedValueOnce({ success: true, data: [{ id: 'u-2' }] });
      const response = await controller.listMembers(seatManagerCtx);
      expect(response.statusCode).toBe(200);
      expect(response.data).toEqual([{ id: 'u-2' }]);
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

    // The deny shape is an empty list, not a 403: AUT-19 accepts either, and an
    // empty body leaks nothing. `toEqual` pins that no row (and no e-mail)
    // survives the branch; a status-only assertion would pass on a leaky body.
    it('answers a Member-role caller with an empty list, never the service', async () => {
      const response = await controller.listMembers(memberCtx);
      expect(response).toEqual({ success: true, statusCode: 200, data: [] });
      expect(JSON.stringify(response)).not.toContain('@');
      expect(mockService.listMembers).not.toHaveBeenCalled();
    });

    it('does not widen the read to every key the caller holds', async () => {
      const groupReaderCtx: RequestContext = {
        ...groupManagerCtx,
        permissionScopes: { 'group.read': 'group', 'org.settings.manage': 'organization' },
      };
      const response = await controller.listMembers(groupReaderCtx);
      expect(response).toEqual({ success: true, statusCode: 200, data: [] });
      expect(mockService.listMembers).not.toHaveBeenCalled();
    });

    it('refuses a caller with no active org', async () => {
      const response = await controller.listMembers(noOrgCtx);
      expect(response).toMatchObject({ success: false, statusCode: 403, error: 'FORBIDDEN' });
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

    it('refuses a Member-role caller with a valid body', async () => {
      await expect(
        controller.changeRole(memberCtx, {
          targetUserId: '550e8400-e29b-41d4-a716-446655440000',
          newOrgRoleId: '550e8400-e29b-41d4-a716-446655440001',
        }),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(mockService.changeRole).not.toHaveBeenCalled();
    });

    // The read authority is not a write authority: the Billing preset reads the
    // roster for its seat picker and still cannot change a role (D25).
    it('refuses an org.seat.manage-only holder the role change', async () => {
      await expect(
        controller.changeRole(seatManagerCtx, {
          targetUserId: '550e8400-e29b-41d4-a716-446655440000',
          newOrgRoleId: '550e8400-e29b-41d4-a716-446655440001',
        }),
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

    it('refuses a Member-role caller with a valid target', async () => {
      await expect(
        controller.removeMember(memberCtx, '550e8400-e29b-41d4-a716-446655440000'),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(mockService.removeMember).not.toHaveBeenCalled();
    });

    it('refuses an org.seat.manage-only holder the removal', async () => {
      await expect(
        controller.removeMember(seatManagerCtx, '550e8400-e29b-41d4-a716-446655440000'),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(mockService.removeMember).not.toHaveBeenCalled();
    });
  });
});
