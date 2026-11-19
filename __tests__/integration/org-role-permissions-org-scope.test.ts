import {
  AccountType,
  type CatalogScope,
  isPermissionCatalogKey,
  PERMISSIONS,
  type PermissionCatalogKey,
  type PermissionScope,
  type RequestContext,
} from '@studiq/authz';
import { isPermissionScope } from '@studiq/server/lib/authz';
import { OrgRoleService } from '@studiq/server/services/org-role.service';
import type { Database } from '@studiq/server/types/database';
import { dbRows } from '@studiq/server/lib/supabase/rows';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRealSupabase, cleanupOrganizationDeep } from '#test/integration/helpers';

const suiteId = crypto.randomUUID().slice(0, 8);

// Regression tests for issue #263: PUT /organization/roles/{id}/permissions
// used to delete/insert org_role_permissions by org_role_id alone, so any org
// admin who knew a role id of another organization could replace that org's
// permission matrix. The service now (a) requires a verified membership for the
// active org (ctx.orgRoleId) and (b) scopes the role lookup to the active org.
//
// The service is injected with a SERVICE-ROLE client, which bypasses RLS, so the
// only thing that can block the cross-org write here is the service-level check
// — this test proves the app-layer fix rather than re-testing the #191 policies.
//
// The editor's payload is the whole catalog (ADR-0015 §9), so the last cases
// send complete payloads: a key the caller cannot change still has to survive,
// and `entitlement_profile` has to round-trip through the role update.

/** One entry per catalog key; `granted` names the keys that carry a scope. */
function catalogPayload(granted: Partial<Record<PermissionCatalogKey, CatalogScope>> = {}) {
  return {
    permissions: Object.keys(PERMISSIONS)
      .filter(isPermissionCatalogKey)
      .map((key) => ({ permissionName: key, scope: granted[key] ?? null })),
  };
}

describe(`OrgRoleService.setPermissions org scope`, () => {
  const tag = `${suiteId}-${Date.now()}`;

  let service: SupabaseClient<Database>;
  let orgA: string;
  let orgB: string;
  let orgARoleId: string; // caller's role in org A (verified membership)
  let orgBMemberRole: string; // foreign role the attack targets
  let orgACustomRole: string; // happy-path target in the caller's own org
  let callerScopes: Partial<Record<string, PermissionScope>>;

  async function createOrg(name: string): Promise<string> {
    const { data, error } = await service
      .from('organizations')
      .insert({ name })
      .select('id')
      .single();
    if (error) throw new Error(`org create failed: ${error.message}`);
    return data.id;
  }

  async function roleId(orgId: string, roleName: string): Promise<string> {
    const { data, error } = await service
      .from('org_roles')
      .select('id')
      .eq('organization_id', orgId)
      .eq('name', roleName)
      .single();
    if (error) throw new Error(`role ${roleName} not found: ${error.message}`);
    return data.id;
  }

  async function permissionsOf(roleIdToRead: string) {
    const { data, error } = await service
      .from('org_role_permissions')
      .select('permission_name, scope')
      .eq('org_role_id', roleIdToRead)
      .order('permission_name');
    if (error) throw new Error(`permissions read failed: ${error.message}`);
    return dbRows(data);
  }

  async function profileOf(roleIdToRead: string): Promise<string> {
    const { data, error } = await service
      .from('org_roles')
      .select('entitlement_profile')
      .eq('id', roleIdToRead)
      .single();
    if (error) throw new Error(`role read failed: ${error.message}`);
    return data.entitlement_profile;
  }

  async function replaceRows(
    targetRoleId: string,
    rows: { permission_name: string; scope: string }[],
  ): Promise<void> {
    const { error: deleteError } = await service
      .from('org_role_permissions')
      .delete()
      .eq('org_role_id', targetRoleId);
    if (deleteError) throw new Error(`row clear failed: ${deleteError.message}`);
    if (rows.length === 0) return;
    const { error } = await service
      .from('org_role_permissions')
      .insert(rows.map((row) => ({ org_role_id: targetRoleId, ...row })));
    if (error) throw new Error(`row insert failed: ${error.message}`);
  }

  function ctx(overrides: Partial<RequestContext>): RequestContext {
    return {
      traceId: `org-scope-${suiteId}`,
      userId: `user-${suiteId}`,
      accountType: AccountType.MANAGER,
      activeOrgId: orgA,
      orgRoleId: orgARoleId,
      url: '/api/v1/organization/roles/x/permissions',
      method: 'PUT',
      groupIds: [],
      permissionScopes: callerScopes,
      ...overrides,
    };
  }

  beforeAll(async () => {
    // Database-typed: `OrgRoleService` takes a factory that hands back the typed client.
    service = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );

    orgA = await createOrg(`orgscope-a-${tag}`);
    orgB = await createOrg(`orgscope-b-${tag}`);

    // The org trigger seeds member/teacher/admin roles per organization.
    orgARoleId = await roleId(orgA, 'admin');
    orgBMemberRole = await roleId(orgB, 'member');

    // with-auth derives `permissionScopes` from the caller's own role rows; the
    // caller here is org A's Admin, so its authority is read from that role.
    callerScopes = {};
    for (const row of await permissionsOf(orgARoleId)) {
      if (isPermissionScope(row.scope)) callerScopes[row.permission_name] = row.scope;
    }

    const { data: customRole, error: customError } = await service
      .from('org_roles')
      .insert({
        organization_id: orgA,
        name: 'custom-scoped',
        display_name: 'custom-scoped',
        description: null,
        is_system: false,
      })
      .select('id')
      .single();
    if (customError) {
      throw new Error(`custom role create failed: ${customError.message}`);
    }
    orgACustomRole = customRole.id;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useRealSupabase();
  });

  afterAll(async () => {
    await cleanupOrganizationDeep(orgA).catch(() => {});
    await cleanupOrganizationDeep(orgB).catch(() => {});
  });

  it('returns NOT_FOUND for a role outside the active org and leaves its rows untouched', async () => {
    const orgRoleService = new OrgRoleService(() => Promise.resolve(service));
    const before = await permissionsOf(orgBMemberRole);
    expect(before.length).toBeGreaterThan(0);

    const result = await orgRoleService.setPermissions(ctx({}), orgBMemberRole, {
      permissions: [{ permissionName: 'flashcard.read', scope: 'own' }],
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable');
    expect(result.error).toBe('NOT_FOUND');

    const after = await permissionsOf(orgBMemberRole);
    expect(after).toEqual(before);
  });

  it('returns FORBIDDEN when the active org cookie points at an org the caller is not a member of', async () => {
    const orgRoleService = new OrgRoleService(() => Promise.resolve(service));
    const before = await permissionsOf(orgBMemberRole);

    // with-auth leaves orgRoleId null when no org_members row exists for
    // (cookie org, user) — a forged active_org_id cookie looks like this.
    const result = await orgRoleService.setPermissions(
      ctx({ activeOrgId: orgB, orgRoleId: null }),
      orgBMemberRole,
      { permissions: [{ permissionName: 'flashcard.read', scope: 'own' }] },
    );

    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable');
    expect(result.error).toBe('FORBIDDEN');

    const after = await permissionsOf(orgBMemberRole);
    expect(after).toEqual(before);
  });

  it('replaces permissions for a role in the caller own org (happy path preserved)', async () => {
    const orgRoleService = new OrgRoleService(() => Promise.resolve(service));

    const result = await orgRoleService.setPermissions(ctx({}), orgACustomRole, {
      permissions: [
        { permissionName: 'flashcard.read', scope: 'own' },
        { permissionName: 'quiz.read', scope: 'group' },
      ],
    });

    expect(result.success).toBe(true);

    const after = await permissionsOf(orgACustomRole);
    expect(after).toEqual([
      { permission_name: 'flashcard.read', scope: 'own' },
      { permission_name: 'quiz.read', scope: 'group' },
    ]);
  });

  it('keeps a no-op row the caller cannot change when the payload is complete', async () => {
    const orgRoleService = new OrgRoleService(() => Promise.resolve(service));
    await replaceRows(orgACustomRole, [{ permission_name: 'deck.read', scope: 'organization' }]);

    // The caller holds `deck.read` at `own` only and owns nothing, so it may not
    // move the grant — but re-sending it unchanged is not a change (D21).
    const narrowCtx = ctx({ permissionScopes: { 'deck.read': 'own' } });

    const result = await orgRoleService.setPermissions(
      narrowCtx,
      orgACustomRole,
      catalogPayload({ 'deck.read': 'organization' }),
    );

    expect(result.success).toBe(true);
    expect(await permissionsOf(orgACustomRole)).toEqual([
      { permission_name: 'deck.read', scope: 'organization' },
    ]);
  });

  it('refuses to lower a grant the caller cannot change and leaves the rows untouched', async () => {
    const orgRoleService = new OrgRoleService(() => Promise.resolve(service));
    await replaceRows(orgACustomRole, [{ permission_name: 'deck.read', scope: 'organization' }]);
    const narrowCtx = ctx({ permissionScopes: { 'deck.read': 'own' } });

    const result = await orgRoleService.setPermissions(
      narrowCtx,
      orgACustomRole,
      catalogPayload({ 'deck.read': 'own' }),
    );

    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable');
    expect(result.error).toBe('FORBIDDEN');
    expect(await permissionsOf(orgACustomRole)).toEqual([
      { permission_name: 'deck.read', scope: 'organization' },
    ]);
  });

  it('round-trips the role entitlement profile', async () => {
    const orgRoleService = new OrgRoleService(() => Promise.resolve(service));
    expect(await profileOf(orgACustomRole)).toBe('none');

    const update = await orgRoleService.updateRole(ctx({}), orgACustomRole, {
      entitlementProfile: 'learner',
    });
    expect(update.success).toBe(true);

    expect(await profileOf(orgACustomRole)).toBe('learner');
    const read = await orgRoleService.getRole(ctx({}), orgACustomRole);
    expect(read.success).toBe(true);
    if (!read.success) throw new Error('unreachable');
    expect(read.data.entitlementProfile).toBe('learner');

    const list = await orgRoleService.listRoles(ctx({}));
    expect(list.success).toBe(true);
    if (!list.success) throw new Error('unreachable');
    expect(list.data.find((role) => role.id === orgACustomRole)?.entitlementProfile).toBe(
      'learner',
    );
  });
});
