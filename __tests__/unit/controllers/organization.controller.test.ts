import { AccountType, type RequestContext } from '@studiq/authz';
import { OrganizationController } from '@studiq/server/controllers/organization.controller';
import type { OrganizationService } from '@studiq/server/services/organization.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asService } from '#test/helpers/service-double';

const requireEntitlementMock = vi.fn<(...args: unknown[]) => unknown>();
vi.mock('@studiq/server/lib/entitlements', () => ({
  requireEntitlement: (...args: unknown[]) => requireEntitlementMock(...args),
}));

const ORG_ID = '550e8400-e29b-41d4-a716-446655440000';

function createMockService() {
  return { update: vi.fn(), getById: vi.fn() };
}

/** A role holding `org.settings.manage` at organization scope (the Admin role). */
const holderCtx: RequestContext = {
  traceId: 'test',
  userId: 'u-1',
  accountType: AccountType.MANAGER,
  orgRoleId: 'role-admin',
  activeOrgId: ORG_ID,
  url: '',
  method: 'PUT',
  groupIds: [],
  permissionScopes: { 'org.settings.manage': 'organization' },
};

/** The seeded Member role: in the org, no `org.*` key. */
const memberCtx: RequestContext = {
  ...holderCtx,
  accountType: AccountType.STUDENT,
  orgRoleId: 'role-member',
  permissionScopes: {},
};

let mockService: ReturnType<typeof createMockService>;
let controller: OrganizationController;

describe('OrganizationController.update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireEntitlementMock.mockResolvedValue(undefined);
    mockService = createMockService();
    mockService.update.mockResolvedValue({ success: true, data: { id: ORG_ID } });
    controller = new OrganizationController(asService<OrganizationService>(mockService));
  });

  it('renames an org for an org.settings.manage holder without checking branding', async () => {
    const response = await controller.update(holderCtx, ORG_ID, { name: 'Nowa nazwa' });

    expect(response).toMatchObject({ success: true, statusCode: 200 });
    expect(requireEntitlementMock).not.toHaveBeenCalled();
    expect(mockService.update).toHaveBeenCalledWith(ORG_ID, { name: 'Nowa nazwa' });
  });

  it('requires the branding entitlement as well when the body carries branding', async () => {
    const response = await controller.update(holderCtx, ORG_ID, { brandColor: '#123456' });

    expect(response).toMatchObject({ success: true });
    expect(requireEntitlementMock).toHaveBeenCalledWith(holderCtx, 'branding');
  });

  it('refuses a Member-role caller before the body or the feature is touched', async () => {
    await expect(
      controller.update(memberCtx, ORG_ID, { logoUrl: 'https://example.test/logo.png' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });

    expect(requireEntitlementMock).not.toHaveBeenCalled();
    expect(mockService.update).not.toHaveBeenCalled();
  });

  it('refuses a caller with no active org', async () => {
    await expect(
      controller.update({ ...memberCtx, activeOrgId: null }, ORG_ID, { name: 'x' }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mockService.update).not.toHaveBeenCalled();
  });

  it('gates before validation: an invalid body still answers 403 without the key', async () => {
    await expect(controller.update(memberCtx, ORG_ID, { name: 42 })).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(mockService.update).not.toHaveBeenCalled();
  });
});
