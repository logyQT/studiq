import {
  AccountType,
  type EntitlementProfile,
  type PermissionCatalogKey,
  type PermissionScope,
  type RequestContext,
  ROLE_TEMPLATES,
} from '@studiq/authz';
import type { ServiceResult } from '@studiq/server/lib/service-result';
import { CATALOG_PERMISSION_KEYS } from '@studiq/server/models/org-role.model';
import { OrgRoleService } from '@studiq/server/services/org-role.service';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { asJson } from '#test/helpers/json';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

const { log } = vi.hoisted(() => ({ log: vi.fn() }));

vi.mock('@studiq/server/lib/log', () => ({ log, warn: vi.fn(), error: vi.fn() }));

type QueryResult = { data: unknown; error: unknown; count?: number };
type QueryChain = {
  select: Mock<(...args: unknown[]) => QueryChain>;
  insert: Mock<(...args: unknown[]) => QueryChain>;
  upsert: Mock<(...args: unknown[]) => QueryChain>;
  update: Mock<(...args: unknown[]) => QueryChain>;
  delete: Mock<(...args: unknown[]) => QueryChain>;
  eq: Mock<(...args: unknown[]) => QueryChain>;
  neq: Mock<(...args: unknown[]) => QueryChain>;
  not: Mock<(...args: unknown[]) => QueryChain>;
  order: Mock<(...args: unknown[]) => QueryChain>;
  single: Mock<(...args: unknown[]) => Promise<QueryResult>>;
  maybeSingle: Mock<(...args: unknown[]) => Promise<QueryResult>>;
  then: Promise<QueryResult>['then'];
  catch: Promise<QueryResult>['catch'];
  finally: Promise<QueryResult>['finally'];
};

/** The position of a mock's first call, `Infinity` when it never ran. */
function callOrder(fn: Mock): number {
  return fn.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY;
}

/** Narrows a service result to its data, failing the test when the call failed. */
function expectSuccess<T>(result: ServiceResult<T>): T {
  if (!result.success) throw new Error(`expected success, got ${result.error}`);
  return result.data;
}

function qb(data: unknown, error: unknown = null, count?: number) {
  const result: QueryResult =
    count !== undefined ? { data: data ?? null, count, error } : { data: data ?? null, error };
  const promise = Promise.resolve(result);
  const b: QueryChain = {
    select: vi.fn(() => b),
    insert: vi.fn(() => b),
    upsert: vi.fn(() => b),
    update: vi.fn(() => b),
    delete: vi.fn(() => b),
    eq: vi.fn(() => b),
    neq: vi.fn(() => b),
    not: vi.fn(() => b),
    order: vi.fn(() => b),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };
  return b;
}

/** Every catalog key at organization scope — the seeded Admin role's authority. */
function adminScopes(): Partial<Record<string, PermissionScope>> {
  return Object.fromEntries(CATALOG_PERMISSION_KEYS.map((key) => [key, 'organization']));
}

/** The same authority without ownership: a caller that may not edit its own role. */
function nonOwnerScopes(): Partial<Record<string, PermissionScope>> {
  const scopes = adminScopes();
  delete scopes['org.admin'];
  return scopes;
}

/** A body the closed-catalog schema would accept: one entry per key. */
function catalogPayload(
  scopes: Partial<Record<PermissionCatalogKey, 'own' | 'group' | 'organization' | null>> = {},
) {
  return {
    permissions: CATALOG_PERMISSION_KEYS.map((key) => ({
      permissionName: key,
      scope: scopes[key] ?? null,
    })),
  };
}

/** A profile outside the enum, the way a hand-crafted request body could carry it. */
function unknownProfile(value: string): EntitlementProfile {
  return asJson<EntitlementProfile>(value);
}

/** The `org_roles` lookup row `setPermissions` reads before it authorizes anything. */
function roleRow(permissions: { permission_key: string; scope: string }[] = []) {
  return { id: 'r-1', name: 'editor', org_role_permissions: permissions };
}

describe('OrgRoleService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  let service: OrgRoleService;
  const ctx: RequestContext = {
    userId: 'test-user-id',
    accountType: AccountType.EDUCATOR,
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
    service = new OrgRoleService(() => Promise.resolve(mock));
  });

  describe('listRoles', () => {
    it('returns FORBIDDEN when no activeOrgId', async () => {
      const result = await service.listRoles({ ...ctx, activeOrgId: null });

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
    });

    it('returns roles with counts and the entitlement profile', async () => {
      const data = [
        {
          id: 'r-1',
          name: 'admin',
          display_name: 'Admin',
          description: null,
          is_system: true,
          entitlement_profile: 'all',
          org_members: [{ count: 3 }],
          org_role_permissions: [{ count: 5 }],
        },
      ];
      mock.from.mockReturnValueOnce(qb(data));

      const result = await service.listRoles(ctx);

      expect(result.success).toBe(true);
      expect(expectSuccess(result)).toHaveLength(1);
      expect(expectSuccess(result)[0]?.memberCount).toBe(3);
      expect(expectSuccess(result)[0]?.permissionCount).toBe(5);
      expect(expectSuccess(result)[0]?.entitlementProfile).toBe('all');
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

    it('returns role with permissions and the entitlement profile', async () => {
      const data = {
        id: 'r-1',
        name: 'admin',
        display_name: 'Admin',
        description: null,
        is_system: true,
        entitlement_profile: 'learner',
        org_role_permissions: [{ permission_key: 'flashcard.read', scope: 'own' }],
      };
      mock.from.mockReturnValueOnce(qb(data));

      const result = await service.getRole(ctx, 'r-1');

      expect(result.success).toBe(true);
      expect(expectSuccess(result).permissions).toEqual([
        { permissionName: 'flashcard.read', scope: 'own' },
      ]);
      expect(expectSuccess(result).entitlementProfile).toBe('learner');
    });

    // A database older than the closed CHECK can still hold one; the read has to
    // refuse it without the column ever reaching a client.
    it('drops a stored row whose scope is outside the catalog', async () => {
      const data = {
        id: 'r-1',
        name: 'legacy',
        display_name: 'legacy',
        description: null,
        is_system: false,
        entitlement_profile: 'none',
        org_role_permissions: [
          { permission_key: 'deck.read', scope: 'any' },
          { permission_key: 'topic.read', scope: 'own' },
        ],
      };
      mock.from.mockReturnValueOnce(qb(data));

      const result = await service.getRole(ctx, 'r-1');

      expect(result.success).toBe(true);
      expect(expectSuccess(result).permissions).toEqual([
        { permissionName: 'topic.read', scope: 'own' },
      ]);
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

    it('creates a role with the fail-closed profile by default', async () => {
      const dbRole = {
        id: 'r-1',
        name: 'editor',
        display_name: 'editor',
        description: null,
        is_system: false,
        entitlement_profile: 'none',
      };
      const insertQb = qb(dbRole);
      mock.from.mockReturnValueOnce(insertQb);

      const result = await service.createRole(ctx, { name: 'editor' });

      expect(result.success).toBe(true);
      expect(insertQb.insert).toHaveBeenCalledWith(
        expect.objectContaining({ entitlement_profile: 'none' }),
      );
      expect(result.data).toEqual({
        id: 'r-1',
        name: 'editor',
        displayName: 'editor',
        description: null,
        isSystem: false,
        entitlementProfile: 'none',
      });
    });

    it('writes the requested entitlement profile', async () => {
      const insertQb = qb({
        id: 'r-1',
        name: 'editor',
        display_name: 'editor',
        description: null,
        is_system: false,
        entitlement_profile: 'learner',
      });
      mock.from.mockReturnValueOnce(insertQb);

      const result = await service.createRole(ctx, {
        name: 'editor',
        entitlementProfile: 'learner',
      });

      expect(result.success).toBe(true);
      expect(insertQb.insert).toHaveBeenCalledWith(
        expect.objectContaining({ entitlement_profile: 'learner' }),
      );
      expect(expectSuccess(result).entitlementProfile).toBe('learner');
    });

    it('returns UNPROCESSABLE_ENTITY for an unknown profile', async () => {
      const result = await service.createRole(ctx, {
        name: 'editor',
        // The schema rejects this first; the service is also a direct entry point (tests).
        entitlementProfile: unknownProfile('everything'),
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('UNPROCESSABLE_ENTITY');
      expect(mock.from).not.toHaveBeenCalled();
    });

    it('materialises a preset as an ordinary custom role with its permission rows', async () => {
      const insertQb = qb({
        id: 'r-1',
        name: 'Assistant',
        display_name: 'Assistant',
        description: null,
        is_system: false,
        entitlement_profile: 'none',
      });
      const permissionsQb = qb(null);
      mock.from.mockReturnValueOnce(insertQb).mockReturnValueOnce(permissionsQb);

      const result = await service.createRole(ctx, { name: 'Assistant', template: 'assistant' });

      expect(result.success).toBe(true);
      expect(insertQb.insert).toHaveBeenCalledWith(
        expect.objectContaining({ is_system: false, entitlement_profile: 'none' }),
      );
      const expected = Object.entries(ROLE_TEMPLATES.assistant.permissions).map(
        ([permission_key, scope]) => ({
          org_role_id: 'r-1',
          permission_key,
          scope,
        }),
      );
      expect(permissionsQb.insert).toHaveBeenCalledWith(expected);
    });

    it('creates zero permission rows for the blank template', async () => {
      const insertQb = qb({
        id: 'r-1',
        name: 'Fresh',
        display_name: 'Fresh',
        description: null,
        is_system: false,
        entitlement_profile: 'none',
      });
      mock.from.mockReturnValueOnce(insertQb);

      const result = await service.createRole(ctx, { name: 'Fresh', template: 'blank' });

      expect(result.success).toBe(true);
      expect(mock.from).toHaveBeenCalledTimes(1);
      expect(mock.from).toHaveBeenCalledWith('org_roles');
    });

    it('deletes the role when its preset rows fail to insert', async () => {
      const insertQb = qb({
        id: 'r-1',
        name: 'Assistant',
        display_name: 'Assistant',
        description: null,
        is_system: false,
        entitlement_profile: 'none',
      });
      const permissionsQb = qb(null, { code: '23503', message: 'permission_key_fkey' });
      const deleteQb = qb(null);
      mock.from
        .mockReturnValueOnce(insertQb)
        .mockReturnValueOnce(permissionsQb)
        .mockReturnValueOnce(deleteQb);

      const result = await service.createRole(ctx, { name: 'Assistant', template: 'assistant' });

      expect(result.success).toBe(false);
      if (result.success) throw new Error('unreachable');
      expect(result.error).toBe('BAD_REQUEST');
      expect(deleteQb.delete).toHaveBeenCalled();
      expect(deleteQb.eq).toHaveBeenCalledWith('id', 'r-1');
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
        entitlement_profile: 'none',
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
        entitlementProfile: 'none',
      });
    });

    it('writes the entitlement profile on its own', async () => {
      mock.from.mockReturnValueOnce(qb({ is_system: false }));
      const updateQb = qb({
        id: 'r-1',
        name: 'editor',
        display_name: 'editor',
        description: null,
        is_system: false,
        entitlement_profile: 'learner',
      });
      mock.from.mockReturnValueOnce(updateQb);

      const result = await service.updateRole(ctx, 'r-1', { entitlementProfile: 'learner' });

      expect(result.success).toBe(true);
      expect(updateQb.update).toHaveBeenCalledWith({ entitlement_profile: 'learner' });
      expect(expectSuccess(result).entitlementProfile).toBe('learner');
    });

    it('returns UNPROCESSABLE_ENTITY for an unknown profile', async () => {
      mock.from.mockReturnValueOnce(qb({ is_system: false }));

      const result = await service.updateRole(ctx, 'r-1', {
        entitlementProfile: unknownProfile('everything'),
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('UNPROCESSABLE_ENTITY');
      // Only the existence check ran — nothing was written.
      expect(mock.from).toHaveBeenCalledTimes(1);
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
        entitlement_profile: 'none',
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
      expect(expectSuccess(result).displayName).toBe('Asystent Lektora');
    });

    it('does not touch display_name on a description-only update', async () => {
      const dbUpdated = {
        id: 'r-1',
        name: 'Asystent Lektora',
        display_name: 'Asystent Lektora',
        description: 'Opis po drugiej edycji',
        is_system: false,
        entitlement_profile: 'none',
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

  function mockRoleLookup(row: unknown = roleRow()) {
    const roleQb = qb(row);
    mock.from.mockReturnValueOnce(roleQb);
    return roleQb;
  }

  describe('setPermissions', () => {
    // setPermissions requires a verified membership for the active org
    // (orgRoleId is only set when with-auth found a real org_members row).
    const permCtx: RequestContext = {
      ...ctx,
      activeOrgId: 'org-1',
      orgRoleId: 'r-caller',
      permissionScopes: adminScopes(),
    };

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

      const result = await service.setPermissions(permCtx, 'r-other-org', catalogPayload());

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
      // Only the role lookup ran — no write.
      expect(mock.from).toHaveBeenCalledTimes(1);
    });

    it('returns UNPROCESSABLE_ENTITY for a payload that is not the whole catalog', async () => {
      // Stubbed so a service that accepted the partial payload fails on the
      // assertions below instead of on an unstubbed client call.
      mockRoleLookup();
      mock.from.mockReturnValueOnce(qb(undefined)); // upsert
      mock.from.mockReturnValueOnce(qb(undefined)); // prune

      const result = await service.setPermissions(permCtx, 'r-1', {
        permissions: [{ permissionName: 'flashcard.read', scope: 'own' }],
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('UNPROCESSABLE_ENTITY');
      // The direct entry point refuses before it reads or writes a row.
      expect(mock.from).not.toHaveBeenCalled();
    });

    it('scopes the role lookup to the active org and upserts the granted rows', async () => {
      const roleQb = mockRoleLookup();
      const upsertQb = qb(undefined);
      const pruneQb = qb(undefined);
      mock.from.mockReturnValueOnce(upsertQb);
      mock.from.mockReturnValueOnce(pruneQb);

      const result = await service.setPermissions(
        permCtx,
        'r-1',
        catalogPayload({ 'flashcard.read': 'own', 'deck.read': 'group' }),
      );

      expect(result.success).toBe(true);
      expect(mock.from).toHaveBeenNthCalledWith(1, 'org_roles');
      expect(roleQb.eq).toHaveBeenCalledWith('id', 'r-1');
      expect(roleQb.eq).toHaveBeenCalledWith('organization_id', 'org-1');
      expect(mock.from).toHaveBeenNthCalledWith(2, 'org_role_permissions');
      expect(upsertQb.upsert).toHaveBeenCalledWith(
        [
          { org_role_id: 'r-1', permission_key: 'flashcard.read', scope: 'own' },
          { org_role_id: 'r-1', permission_key: 'deck.read', scope: 'group' },
        ],
        { onConflict: 'org_role_id,permission_key', ignoreDuplicates: false },
      );
      expect(pruneQb.eq).toHaveBeenCalledWith('org_role_id', 'r-1');
      expect(pruneQb.not).toHaveBeenCalledWith(
        'permission_key',
        'in',
        '("flashcard.read","deck.read")',
      );
    });

    it('upserts the granted keys before it prunes the rest', async () => {
      mockRoleLookup();
      const upsertQb = qb(undefined);
      const pruneQb = qb(undefined);
      mock.from.mockReturnValueOnce(upsertQb);
      mock.from.mockReturnValueOnce(pruneQb);

      const result = await service.setPermissions(
        permCtx,
        'r-1',
        catalogPayload({ 'flashcard.read': 'own', 'deck.read': 'group' }),
      );

      expect(result.success).toBe(true);
      expect(callOrder(pruneQb.delete)).not.toBe(Number.POSITIVE_INFINITY);
      expect(callOrder(upsertQb.upsert)).toBeLessThan(callOrder(pruneQb.delete));
    });

    it('succeeds with a complete all-null payload and prunes every row', async () => {
      mockRoleLookup(roleRow([{ permission_key: 'deck.read', scope: 'group' }]));
      const pruneQb = qb(undefined);
      mock.from.mockReturnValueOnce(pruneQb); // prune

      const result = await service.setPermissions(permCtx, 'r-1', catalogPayload());

      expect(result.success).toBe(true);
      expect(mock.from).toHaveBeenCalledTimes(2);
      expect(pruneQb.delete).toHaveBeenCalled();
      // No grant list to keep: the delete is unscoped on permission_key.
      expect(pruneQb.not).not.toHaveBeenCalled();
    });

    it('returns FORBIDDEN when editing the caller own role without ownership', async () => {
      mockRoleLookup();
      // Stubbed so a guard that stops blocking the write fails on the assertion
      // below instead of on an unstubbed client call.
      mock.from.mockReturnValueOnce(qb(undefined)); // upsert
      mock.from.mockReturnValueOnce(qb(undefined)); // prune
      const selfCtx = { ...permCtx, orgRoleId: 'r-1', permissionScopes: nonOwnerScopes() };

      const result = await service.setPermissions(selfCtx, 'r-1', catalogPayload());

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
      expect(mock.from).toHaveBeenCalledTimes(1);
    });

    it('lets an org.admin holder edit the Admin role it belongs to', async () => {
      mockRoleLookup(
        roleRow([
          { permission_key: 'org.admin', scope: 'organization' },
          { permission_key: 'org.role.manage', scope: 'organization' },
        ]),
      );
      mock.from.mockReturnValueOnce(qb(undefined)); // upsert
      mock.from.mockReturnValueOnce(qb(undefined)); // prune
      const selfCtx = { ...permCtx, orgRoleId: 'r-1' };

      // The gate and ownership are both re-sent unchanged: the edit is a no-op for
      // them, so it is the self-edit exemption under test, not a gate removal.
      const result = await service.setPermissions(
        selfCtx,
        'r-1',
        catalogPayload({ 'org.admin': 'organization', 'org.role.manage': 'organization' }),
      );

      expect(result.success).toBe(true);
    });

    it('refuses to remove the last org.role.manage grant', async () => {
      // The caller owns the org and is editing its own Admin role, so every other
      // guard passes; only the last-holder count stands between this save and an
      // org where no role can manage roles.
      mockRoleLookup(roleRow([{ permission_key: 'org.role.manage', scope: 'organization' }]));
      const gateQb = qb([], null, 0);
      mock.from.mockReturnValueOnce(gateQb); // other-holder count
      // Stubbed so a service that wrote anyway fails on the assertions below, not on
      // an unstubbed client call.
      mock.from.mockReturnValueOnce(qb(undefined)); // upsert, must not run
      mock.from.mockReturnValueOnce(qb(undefined)); // prune, must not run
      const selfCtx = { ...permCtx, orgRoleId: 'r-1' };

      const result = await service.setPermissions(selfCtx, 'r-1', catalogPayload());

      expect(result.success).toBe(false);
      expect(result.error).toBe('CONFLICT');
      // The count ran, and nothing was written.
      expect(gateQb.eq).toHaveBeenCalledWith('permission_key', 'org.role.manage');
      expect(gateQb.eq).toHaveBeenCalledWith('org_roles.organization_id', 'org-1');
      expect(gateQb.neq).toHaveBeenCalledWith('org_role_id', 'r-1');
      expect(mock.from).toHaveBeenCalledTimes(2);
    });

    it('counts a gate row the editor cannot render as a holder', async () => {
      // The editor renders an out-of-catalog scope as revoked, but a row read from
      // a database older than the closed CHECK still answers `can()` and the RLS
      // predicate, so pruning it can be the last holder.
      mockRoleLookup(roleRow([{ permission_key: 'org.role.manage', scope: 'any' }]));
      mock.from.mockReturnValueOnce(qb([], null, 0)); // other-holder count
      mock.from.mockReturnValueOnce(qb(undefined)); // upsert, must not run
      mock.from.mockReturnValueOnce(qb(undefined)); // prune, must not run
      const selfCtx = { ...permCtx, orgRoleId: 'r-1' };

      const result = await service.setPermissions(selfCtx, 'r-1', catalogPayload());

      expect(result.success).toBe(false);
      expect(result.error).toBe('CONFLICT');
    });

    it('removes org.role.manage when another role still holds it', async () => {
      mockRoleLookup(roleRow([{ permission_key: 'org.role.manage', scope: 'organization' }]));
      mock.from.mockReturnValueOnce(qb([], null, 1)); // another holder
      const upsertQb = qb(undefined);
      const pruneQb = qb(undefined);
      mock.from.mockReturnValueOnce(upsertQb);
      mock.from.mockReturnValueOnce(pruneQb);
      const selfCtx = { ...permCtx, orgRoleId: 'r-1' };

      const result = await service.setPermissions(
        selfCtx,
        'r-1',
        catalogPayload({ 'flashcard.read': 'own' }),
      );

      expect(result.success).toBe(true);
      expect(upsertQb.upsert).toHaveBeenCalledWith(
        [{ org_role_id: 'r-1', permission_key: 'flashcard.read', scope: 'own' }],
        { onConflict: 'org_role_id,permission_key', ignoreDuplicates: false },
      );
      expect(pruneQb.not).toHaveBeenCalledWith('permission_key', 'in', '("flashcard.read")');
    });

    it('refuses to grant a key the caller does not hold', async () => {
      mockRoleLookup();
      mock.from.mockReturnValueOnce(qb(undefined)); // upsert
      mock.from.mockReturnValueOnce(qb(undefined)); // prune
      const scopes = nonOwnerScopes();
      delete scopes['org.member.manage'];

      const result = await service.setPermissions(
        { ...permCtx, permissionScopes: scopes },
        'r-1',
        catalogPayload({ 'org.member.manage': 'organization' }),
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
      // Nothing was written.
      expect(mock.from).toHaveBeenCalledTimes(1);
    });

    it('refuses to remove a grant the caller holds at a narrower scope', async () => {
      mockRoleLookup(roleRow([{ permission_key: 'deck.read', scope: 'organization' }]));
      mock.from.mockReturnValueOnce(qb(undefined)); // upsert
      mock.from.mockReturnValueOnce(qb(undefined)); // prune

      const result = await service.setPermissions(
        { ...permCtx, permissionScopes: { 'deck.read': 'own' } },
        'r-1',
        catalogPayload({ 'deck.read': null }),
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
      expect(mock.from).toHaveBeenCalledTimes(1);
    });

    it('lets a no-op entry through without the caller holding the key', async () => {
      mockRoleLookup(roleRow([{ permission_key: 'org.member.manage', scope: 'organization' }]));
      const upsertQb = qb(undefined);
      mock.from.mockReturnValueOnce(upsertQb); // upsert
      mock.from.mockReturnValueOnce(qb(undefined)); // prune

      const result = await service.setPermissions(
        { ...permCtx, permissionScopes: {} },
        'r-1',
        catalogPayload({ 'org.member.manage': 'organization' }),
      );

      expect(result.success).toBe(true);
      expect(upsertQb.upsert).toHaveBeenCalledWith(
        [{ org_role_id: 'r-1', permission_key: 'org.member.manage', scope: 'organization' }],
        { onConflict: 'org_role_id,permission_key', ignoreDuplicates: false },
      );
    });

    it('refuses to grant org.admin to a role that does not hold it', async () => {
      mockRoleLookup();
      mock.from.mockReturnValueOnce(qb(undefined)); // upsert
      mock.from.mockReturnValueOnce(qb(undefined)); // prune

      const result = await service.setPermissions(
        permCtx,
        'r-1',
        catalogPayload({ 'org.admin': 'organization' }),
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('UNPROCESSABLE_ENTITY');
      expect(mock.from).toHaveBeenCalledTimes(1);
    });

    it('refuses to revoke org.admin from the role that holds it', async () => {
      mockRoleLookup(roleRow([{ permission_key: 'org.admin', scope: 'organization' }]));
      mock.from.mockReturnValueOnce(qb(undefined)); // upsert
      mock.from.mockReturnValueOnce(qb(undefined)); // prune

      const result = await service.setPermissions(permCtx, 'r-1', catalogPayload());

      expect(result.success).toBe(false);
      expect(result.error).toBe('UNPROCESSABLE_ENTITY');
      expect(mock.from).toHaveBeenCalledTimes(1);
    });

    it('logs the actor, the role and both permission maps', async () => {
      const roleQb = mockRoleLookup(
        roleRow([
          { permission_key: 'flashcard.read', scope: 'own' },
          { permission_key: 'deck.read', scope: 'group' },
        ]),
      );
      mock.from.mockReturnValueOnce(qb(undefined)); // upsert
      mock.from.mockReturnValueOnce(qb(undefined)); // prune

      const result = await service.setPermissions(
        permCtx,
        'r-1',
        catalogPayload({ 'flashcard.read': 'own', 'deck.read': 'organization' }),
      );

      expect(result.success).toBe(true);
      expect(roleQb.select).toHaveBeenCalledWith(
        'id, name, org_role_permissions(permission_key, scope)',
      );
      expect(log).toHaveBeenCalledWith('org role permissions changed', {
        'actor.user_id': 'test-user-id',
        'org.id': 'org-1',
        'role.id': 'r-1',
        'role.name': 'editor',
        'permissions.before': { 'flashcard.read': 'own', 'deck.read': 'group' },
        'permissions.after': { 'flashcard.read': 'own', 'deck.read': 'organization' },
      });
    });

    it('returns error on upsert failure and never prunes the previous rows', async () => {
      mockRoleLookup(
        roleRow([
          { permission_key: 'deck.read', scope: 'organization' },
          { permission_key: 'topic.read', scope: 'own' },
        ]),
      );
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' })); // upsert
      // Stubbed so a service that pruned anyway fails on the assertions below,
      // not on an unstubbed client call.
      mock.from.mockReturnValueOnce(qb(undefined)); // a prune that must not run

      const result = await service.setPermissions(
        permCtx,
        'r-1',
        catalogPayload({ 'flashcard.read': 'own' }),
      );

      expect(result.success).toBe(false);
      // The role keeps the rows it had; only the role lookup and the failed upsert
      // ran, so a retry starts from the previous set instead of an empty role.
      expect(mock.from).toHaveBeenCalledTimes(2);
    });

    it('maps a key the catalog rejects to BAD_REQUEST instead of a save that looks applied', async () => {
      mockRoleLookup();
      // The foreign key on `permission_key` answers 23503 for a name no catalog row
      // carries. The editor's 422 already refuses one, so the only way here is a
      // direct entry point writing outside the catalog.
      mock.from.mockReturnValueOnce(qb(null, { code: '23503', message: 'permission_key_fkey' }));

      const result = await service.setPermissions(
        permCtx,
        'r-1',
        catalogPayload({ 'flashcard.read': 'own' }),
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('BAD_REQUEST');
    });

    it('returns error on prune failure', async () => {
      mockRoleLookup();
      mock.from.mockReturnValueOnce(qb(undefined)); // upsert
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' })); // prune

      const result = await service.setPermissions(
        permCtx,
        'r-1',
        catalogPayload({ 'flashcard.read': 'own' }),
      );

      expect(result.success).toBe(false);
    });
  });
});
