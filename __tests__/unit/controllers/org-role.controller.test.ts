import { AccountType, type RequestContext } from '@studiq/authz';
import { OrgRoleController } from '@studiq/server/controllers/org-role.controller';
import { CATALOG_PERMISSION_KEYS } from '@studiq/server/models/org-role.model';
import { OrgRoleService } from '@studiq/server/services/org-role.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@studiq/server/lib/features', () => ({
  requireFeature: vi.fn().mockResolvedValue(undefined),
}));

const ROLE_ID = '550e8400-e29b-41d4-a716-446655440000';

function createMockService() {
  // The mocked methods never touch the database, so the client factory only has
  // to satisfy the constructor's type.
  return Object.assign(new OrgRoleService(() => Promise.reject(new Error('unused'))), {
    setPermissions: vi.fn(),
    updateRole: vi.fn(),
  });
}

/** A body the editor sends: one entry per catalog key, the listed ones granted. */
function payload(granted: Record<string, 'own' | 'group' | 'organization' | null> = {}) {
  return {
    permissions: CATALOG_PERMISSION_KEYS.map((key) => ({
      permissionName: key,
      scope: granted[key] ?? null,
    })),
  };
}

const ctx: RequestContext = {
  traceId: 'test-trace',
  userId: 'test-user-id',
  accountType: AccountType.MANAGER,
  orgRoleId: '550e8400-e29b-41d4-a716-446655440001',
  activeOrgId: 'org-1',
  url: 'http://localhost/api/v1/organization/roles/x/permissions',
  method: 'PUT',
  groupIds: [],
  permissionScopes: {},
};

let mockService: ReturnType<typeof createMockService>;
let controller: OrgRoleController;

describe('OrgRoleController.setPermissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockService();
    controller = new OrgRoleController(mockService);
  });

  it('rejects a payload that omits catalog keys without touching the role', async () => {
    const response = await controller.setPermissions(ctx, ROLE_ID, {
      permissions: [{ permissionName: 'flashcard.read', scope: 'own' }],
    });

    expect(response.success).toBe(false);
    expect(response.statusCode).toBe(422);
    expect(mockService.setPermissions).not.toHaveBeenCalled();
  });

  it('rejects a duplicate key without touching the role', async () => {
    const body = payload({ 'flashcard.read': 'own' });
    const response = await controller.setPermissions(ctx, ROLE_ID, {
      permissions: [...body.permissions, { permissionName: 'flashcard.read', scope: 'group' }],
    });

    expect(response.success).toBe(false);
    expect(response.statusCode).toBe(422);
    expect(mockService.setPermissions).not.toHaveBeenCalled();
  });

  it('rejects a free-text permission name without touching the role', async () => {
    const body = payload();
    const response = await controller.setPermissions(ctx, ROLE_ID, {
      permissions: [
        ...body.permissions,
        { permissionName: 'member.manage', scope: 'organization' },
      ],
    });

    expect(response.success).toBe(false);
    expect(response.statusCode).toBe(422);
    expect(mockService.setPermissions).not.toHaveBeenCalled();
  });

  it('rejects a scope the key does not allow without touching the role', async () => {
    const response = await controller.setPermissions(
      ctx,
      ROLE_ID,
      payload({ 'group.invite': 'own' }),
    );

    expect(response.success).toBe(false);
    expect(response.statusCode).toBe(422);
    expect(mockService.setPermissions).not.toHaveBeenCalled();
  });

  it('passes the complete catalog to the service', async () => {
    mockService.setPermissions.mockResolvedValueOnce({ success: true, data: undefined });
    const body = payload({ 'flashcard.read': 'own' });

    const response = await controller.setPermissions(ctx, ROLE_ID, body);

    expect(response.success).toBe(true);
    expect(response.statusCode).toBe(200);
    expect(mockService.setPermissions).toHaveBeenCalledWith(ctx, ROLE_ID, body);
  });

  it('maps a service refusal to its status code', async () => {
    mockService.setPermissions.mockResolvedValueOnce({ success: false, error: 'FORBIDDEN' });

    const response = await controller.setPermissions(ctx, ROLE_ID, payload());

    expect(response.success).toBe(false);
    expect(response.statusCode).toBe(403);
  });
});

describe('OrgRoleController.updateRole', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockService();
    controller = new OrgRoleController(mockService);
  });

  it('passes the entitlement profile through to the service', async () => {
    mockService.updateRole.mockResolvedValueOnce({
      success: true,
      data: {
        id: ROLE_ID,
        name: 'content-reader',
        description: null,
        isSystem: false,
        entitlementProfile: 'learner',
      },
    });

    const response = await controller.updateRole(ctx, ROLE_ID, { entitlementProfile: 'learner' });

    expect(response.success).toBe(true);
    expect(mockService.updateRole).toHaveBeenCalledWith(ctx, ROLE_ID, {
      entitlementProfile: 'learner',
    });
  });

  it('rejects an unknown entitlement profile', async () => {
    const response = await controller.updateRole(ctx, ROLE_ID, {
      entitlementProfile: 'everything',
    });

    expect(response.success).toBe(false);
    expect(response.statusCode).toBe(422);
    expect(mockService.updateRole).not.toHaveBeenCalled();
  });
});
