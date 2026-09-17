import { RequestContext } from '@studiq/authz';
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

    it('updates a role', async () => {
      const existing = { is_system: false };
      const dbUpdated = {
        id: 'r-1',
        name: 'editor',
        display_name: 'Editor',
        description: null,
        is_system: false,
      };
      mock.from.mockReturnValueOnce(qb(existing));
      mock.from.mockReturnValueOnce(qb(dbUpdated));

      const result = await service.updateRole(ctx, 'r-1', {
        name: 'editor',
        displayName: 'Editor',
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        id: 'r-1',
        name: 'editor',
        displayName: 'Editor',
        description: null,
        isSystem: false,
      });
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
    it('returns FORBIDDEN when no activeOrgId', async () => {
      const result = await service.setPermissions({ ...ctx, activeOrgId: null }, 'r-1', {
        permissions: [],
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
    });

    it('clears and re-inserts permissions', async () => {
      mock.from.mockReturnValueOnce(qb(undefined)); // delete
      mock.from.mockReturnValueOnce(qb(undefined)); // insert

      const result = await service.setPermissions(ctx, 'r-1', {
        permissions: [{ permissionName: 'flashcard.read', scope: 'own' }],
      });

      expect(result.success).toBe(true);
    });

    it('succeeds with empty permissions', async () => {
      mock.from.mockReturnValueOnce(qb(undefined));

      const result = await service.setPermissions(ctx, 'r-1', { permissions: [] });

      expect(result.success).toBe(true);
    });

    it('returns error on delete failure', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.setPermissions(ctx, 'r-1', { permissions: [] });

      expect(result.success).toBe(false);
    });

    it('returns error on insert failure', async () => {
      mock.from.mockReturnValueOnce(qb(undefined));
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.setPermissions(ctx, 'r-1', {
        permissions: [{ permissionName: 'flashcard.read', scope: 'own' }],
      });

      expect(result.success).toBe(false);
    });
  });
});
