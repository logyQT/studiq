import { AccountType, type RequestContext } from '@studiq/authz';
import { OrgRoleController } from '@studiq/server/controllers/org-role.controller';
import { requirePermission } from '@studiq/server/lib/authz';
import { AppError } from '@studiq/server/lib/errors';
import { CATALOG_PERMISSION_KEYS } from '@studiq/server/models/org-role.model';
import { OrgRoleService } from '@studiq/server/services/org-role.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@studiq/server/lib/authz', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@studiq/server/lib/authz')>()),
  // The gate itself is unit-tested in __tests__/unit/lib/authz.test.ts; here the
  // mock records which permission each write route asks for.
  requirePermission: vi.fn().mockResolvedValue(undefined),
}));

const ROLE_ID = '550e8400-e29b-41d4-a716-446655440000';

function createMockService() {
  // The mocked methods never touch the database, so the client factory only has
  // to satisfy the constructor's type.
  return Object.assign(new OrgRoleService(() => Promise.reject(new Error('unused'))), {
    createRole: vi.fn(),
    deleteRole: vi.fn(),
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

describe('OrgRoleController role-management gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockService();
    controller = new OrgRoleController(mockService);
  });

  it('gates every write on `org.role.manage`, not on the role.builder entitlement', async () => {
    mockService.createRole.mockResolvedValueOnce({ success: true, data: {} });
    mockService.updateRole.mockResolvedValueOnce({ success: true, data: {} });
    mockService.deleteRole.mockResolvedValueOnce({ success: true, data: undefined });
    mockService.setPermissions.mockResolvedValueOnce({ success: true, data: undefined });

    await controller.createRole(ctx, { name: 'editor' });
    await controller.updateRole(ctx, ROLE_ID, { name: 'editor' });
    await controller.deleteRole(ctx, ROLE_ID);
    await controller.setPermissions(ctx, ROLE_ID, payload());

    expect(vi.mocked(requirePermission).mock.calls).toEqual([
      [ctx, 'org.role.manage'],
      [ctx, 'org.role.manage'],
      [ctx, 'org.role.manage'],
      [ctx, 'org.role.manage'],
    ]);
  });

  it('reads stay ungated: the list and a single role are readable without the permission', async () => {
    mockService.listRoles = vi.fn().mockResolvedValueOnce({ success: true, data: [] });
    mockService.getRole = vi.fn().mockResolvedValueOnce({ success: true, data: {} });

    await controller.listRoles(ctx);
    await controller.getRole(ctx, ROLE_ID);

    expect(requirePermission).not.toHaveBeenCalled();
  });

  it('refuses the write before the service runs when the caller lacks the permission', async () => {
    vi.mocked(requirePermission).mockRejectedValueOnce(new AppError('FORBIDDEN'));

    await expect(controller.createRole(ctx, { name: 'editor' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(mockService.createRole).not.toHaveBeenCalled();
  });
});
