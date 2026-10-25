import type { RequestContext } from '@studiq/authz';
import { OrgRoleService } from '@studiq/server/services/org-role.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

function qb(data: any, error: any = null, count?: number) {
  const result =
    count !== undefined ? { data: data ?? null, count, error } : { data: data ?? null, error };
  const promise = Promise.resolve(result);
  const b: any = {};
  b.select = vi.fn(() => b);
  b.insert = vi.fn(() => b);
  b.update = vi.fn(() => b);
  b.delete = vi.fn(() => b);
  b.eq = vi.fn(() => b);
  b.order = vi.fn(() => b);
  b.single = vi.fn().mockResolvedValue(result);
  b.maybeSingle = vi.fn().mockResolvedValue(result);
  b.then = promise.then.bind(promise);
  b.catch = promise.catch.bind(promise);
  b.finally = promise.finally.bind(promise);
  return b;
}

describe('OrgRoleService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  let service: OrgRoleService;
  const ctx: RequestContext = {
    userId: 'test-user-id',
    accountType: 'educator' as any,
    traceId: 'test',
    url: '',
    method: 'GET',
    activeOrgId: 'org-1',
    orgRoleId: null,
    groupIds: [],
    permissionScopes: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
    service = new OrgRoleService(async () => mock as any);
  });

  describe('listRoles', () => {
    it('returns FORBIDDEN when no activeOrgId', async () => {
      const result = await service.listRoles({ ...ctx, activeOrgId: null });

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
    });

    it('returns roles with counts', async () => {
      const data = [
        {
          id: 'r-1',
          name: 'admin',
          display_name: 'Admin',
          description: null,
          is_system: true,
          org_members: [{ count: 3 }],
          org_role_permissions: [{ count: 5 }],
        },
      ];
      mock.from.mockReturnValueOnce(qb(data));

      const result = await service.listRoles(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].memberCount).toBe(3);
      expect(result.data[0].permissionCount).toBe(5);
    });

    it('returns error on DB failure', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.listRoles(ctx);

      expect(result.success).toBe(false);
    });
  });

  describe('getRole', () => {
    it('returns FORBIDDEN when no activeOrgId', async () => {
      const result = await service.getRole({ ...ctx, activeOrgId: null }, 'r-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
    });

    it('returns role with permissions', async () => {
      const data = {
        id: 'r-1',
        name: 'admin',
        display_name: 'Admin',
        description: null,
        is_system: true,
        org_role_permissions: [{ permission_name: 'flashcard.read', scope: 'own' }],
      };
      mock.from.mockReturnValueOnce(qb(data));

      const result = await service.getRole(ctx, 'r-1');

      expect(result.success).toBe(true);
      expect(result.data.permissions).toHaveLength(1);
    });

    it('returns error on DB failure', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.getRole(ctx, 'r-1');

      expect(result.success).toBe(false);
    });
  });

  describe('createRole', () => {
    it('returns FORBIDDEN when no activeOrgId', async () => {
      const result = await service.createRole({ ...ctx, activeOrgId: null }, { name: 'editor' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
    });

    it('creates a role', async () => {
      const dbRole = {
        id: 'r-1',
        name: 'editor',
        display_name: 'editor',
        description: null,
        is_system: false,
      };
      mock.from.mockReturnValueOnce(qb(dbRole));

      const result = await service.createRole(ctx, { name: 'editor' });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        id: 'r-1',
        name: 'editor',
        displayName: 'editor',
        description: null,
        isSystem: false,
      });
    });

    it('returns error on DB failure', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.createRole(ctx, { name: 'editor' });

      expect(result.success).toBe(false);
    });
  });

  describe('updateRole', () => {
    it('returns FORBIDDEN when no activeOrgId', async () => {
      const result = await service.updateRole({ ...ctx, activeOrgId: null }, 'r-1', {
        name: 'editor',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
    });

    it('updates a role with an explicit display_name', async () => {
      const existing = { is_system: false };
      const dbUpdated = {
        id: 'r-1',
        name: 'editor',
        display_name: 'Editor',
        description: null,
        is_system: false,
      };
      mock.from.mockReturnValueOnce(qb(existing));
      const updateQb = qb(dbUpdated);
      mock.from.mockReturnValueOnce(updateQb);

      const result = await service.updateRole(ctx, 'r-1', {
        name: 'editor',
        display_name: 'Editor',
      });

      expect(result.success).toBe(true);
      expect(updateQb.update).toHaveBeenCalledWith({
        name: 'editor',
        display_name: 'Editor',
      });
      expect(result.data).toEqual({
        id: 'r-1',
        name: 'editor',
        displayName: 'Editor',
        description: null,
        isSystem: false,
      });
    });

    // Issue #260: the roles dialog only sends `name`, so a rename used to leave
    // display_name (what member/invite pickers render) pointing at the old label.
    it('derives display_name from name when renaming without an explicit display_name', async () => {
      const dbUpdated = {
        id: 'r-1',
        name: 'Asystent Lektora',
        display_name: 'Asystent Lektora',
        description: null,
        is_system: false,
      };
      mock.from.mockReturnValueOnce(qb({ is_system: false }));
      const updateQb = qb(dbUpdated);
      mock.from.mockReturnValueOnce(updateQb);

      const result = await service.updateRole(ctx, 'r-1', { name: 'Asystent Lektora' });

      expect(result.success).toBe(true);
      expect(updateQb.update).toHaveBeenCalledWith({
        name: 'Asystent Lektora',
        display_name: 'Asystent Lektora',
      });
      expect(result.data.displayName).toBe('Asystent Lektora');
    });

    it('does not touch display_name on a description-only update', async () => {
      const dbUpdated = {
        id: 'r-1',
        name: 'Asystent Lektora',
        display_name: 'Asystent Lektora',
        description: 'Opis po drugiej edycji',
        is_system: false,
      };
      mock.from.mockReturnValueOnce(qb({ is_system: false }));
      const updateQb = qb(dbUpdated);
      mock.from.mockReturnValueOnce(updateQb);

      const result = await service.updateRole(ctx, 'r-1', {
        description: 'Opis po drugiej edycji',
      });

      expect(result.success).toBe(true);
      expect(updateQb.update).toHaveBeenCalledWith({ description: 'Opis po drugiej edycji' });
    });

    it('returns FORBIDDEN when trying to rename system role', async () => {
      mock.from.mockReturnValueOnce(qb({ is_system: true }));

      const result = await service.updateRole(ctx, 'r-1', { name: 'newname' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
    });

    it('returns BAD_REQUEST when no fields provided', async () => {
      mock.from.mockReturnValueOnce(qb({ is_system: false }));

      const result = await service.updateRole(ctx, 'r-1', {});

      expect(result.success).toBe(false);
      expect(result.error).toBe('BAD_REQUEST');
    });

    it('returns error on fetch failure', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.updateRole(ctx, 'r-1', { name: 'editor' });

      expect(result.success).toBe(false);
    });

    it('returns error on update failure', async () => {
      mock.from.mockReturnValueOnce(qb({ is_system: false }));
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.updateRole(ctx, 'r-1', { name: 'editor' });

      expect(result.success).toBe(false);
    });
  });

  describe('deleteRole', () => {
    it('returns FORBIDDEN when no activeOrgId', async () => {
      const result = await service.deleteRole({ ...ctx, activeOrgId: null }, 'r-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
    });

    it('deletes a non-system role with no members', async () => {
      mock.from.mockReturnValueOnce(qb({ is_system: false }));
      mock.from.mockReturnValueOnce(qb([], null, 0));
      mock.from.mockReturnValueOnce(qb(undefined));

      const result = await service.deleteRole(ctx, 'r-1');

      expect(result.success).toBe(true);
    });

    it('returns FORBIDDEN for system role', async () => {
      mock.from.mockReturnValueOnce(qb({ is_system: true }));

      const result = await service.deleteRole(ctx, 'r-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
    });

    it('returns CONFLICT when role has members', async () => {
      mock.from.mockReturnValueOnce(qb({ is_system: false }));
      mock.from.mockReturnValueOnce(qb([], null, 3));

      const result = await service.deleteRole(ctx, 'r-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('CONFLICT');
    });

    it('returns error on fetch failure', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.deleteRole(ctx, 'r-1');

      expect(result.success).toBe(false);
    });

    it('returns error on delete failure', async () => {
      mock.from.mockReturnValueOnce(qb({ is_system: false }));
      mock.from.mockReturnValueOnce(qb([], null, 0));
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.deleteRole(ctx, 'r-1');

      expect(result.success).toBe(false);
    });
  });

  describe('setPermissions', () => {
    // setPermissions requires a verified membership for the active org
    // (orgRoleId is only set when with-auth found a real org_members row).
    const permCtx: RequestContext = { ...ctx, activeOrgId: 'org-1', orgRoleId: 'r-caller' };

    function mockRoleLookup() {
      const roleQb = qb({ id: 'r-1' });
      mock.from.mockReturnValueOnce(roleQb);
      return roleQb;
    }

    it('returns FORBIDDEN when no activeOrgId', async () => {
      const result = await service.setPermissions({ ...permCtx, activeOrgId: null }, 'r-1', {
        permissions: [],
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
      expect(mock.from).not.toHaveBeenCalled();
    });

    it('returns FORBIDDEN when orgRoleId is null', async () => {
      const result = await service.setPermissions({ ...permCtx, orgRoleId: null }, 'r-1', {
        permissions: [],
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
      expect(mock.from).not.toHaveBeenCalled();
    });

    it('returns NOT_FOUND for a role outside the active org', async () => {
      mock.from.mockReturnValueOnce(
        qb(null, {
          code: 'PGRST116',
          message: 'JSON object requested, multiple (or no) rows returned',
        }),
      );

      const result = await service.setPermissions(permCtx, 'r-other-org', {
        permissions: [{ permissionName: 'flashcard.read', scope: 'own' }],
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
      // Only the role lookup ran — no DELETE, no INSERT.
      expect(mock.from).toHaveBeenCalledTimes(1);
    });

    it('scopes the role lookup to the active org', async () => {
      const roleQb = mockRoleLookup();
      const deleteQb = qb(undefined);
      const insertQb = qb(undefined);
      mock.from.mockReturnValueOnce(deleteQb);
      mock.from.mockReturnValueOnce(insertQb);

      const result = await service.setPermissions(permCtx, 'r-1', {
        permissions: [{ permissionName: 'flashcard.read', scope: 'own' }],
      });

      expect(result.success).toBe(true);
      expect(mock.from).toHaveBeenNthCalledWith(1, 'org_roles');
      expect(roleQb.eq).toHaveBeenCalledWith('id', 'r-1');
      expect(roleQb.eq).toHaveBeenCalledWith('organization_id', 'org-1');
      expect(mock.from).toHaveBeenNthCalledWith(2, 'org_role_permissions');
      expect(deleteQb.eq).toHaveBeenCalledWith('org_role_id', 'r-1');
      expect(insertQb.insert).toHaveBeenCalledWith([
        { org_role_id: 'r-1', permission_name: 'flashcard.read', scope: 'own' },
      ]);
    });

    it('clears and re-inserts permissions', async () => {
      mockRoleLookup();
      mock.from.mockReturnValueOnce(qb(undefined)); // delete
      mock.from.mockReturnValueOnce(qb(undefined)); // insert

      const result = await service.setPermissions(permCtx, 'r-1', {
        permissions: [{ permissionName: 'flashcard.read', scope: 'own' }],
      });

      expect(result.success).toBe(true);
    });

    it('succeeds with empty permissions', async () => {
      mockRoleLookup();
      mock.from.mockReturnValueOnce(qb(undefined)); // delete

      const result = await service.setPermissions(permCtx, 'r-1', { permissions: [] });

      expect(result.success).toBe(true);
    });

    it('returns error on delete failure', async () => {
      mockRoleLookup();
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.setPermissions(permCtx, 'r-1', { permissions: [] });

      expect(result.success).toBe(false);
    });

    it('returns error on insert failure', async () => {
      mockRoleLookup();
      mock.from.mockReturnValueOnce(qb(undefined));
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.setPermissions(permCtx, 'r-1', {
        permissions: [{ permissionName: 'flashcard.read', scope: 'own' }],
      });

      expect(result.success).toBe(false);
    });
  });
});
