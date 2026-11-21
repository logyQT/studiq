import { readFileSync } from 'node:fs';
import type { Database } from '@studiq/server/types/database';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cleanupOrganizationDeep,
  seedOrgMembership,
  seedOrganization,
} from '#test/integration/helpers';
import { createTypedServiceClient, latestShippedFunction } from '#test/integration/test-utils';

/**
 * The RLS half of the role-editor guards (ADR-0015 §4.4, §9; D16, D21; R4).
 *
 * 2a-2/2a-3 put three guards on the API — system roles cannot be deleted, the
 * last `org.role.manage` holder cannot be removed, and no grant or removal
 * beyond the caller's own authority — but until 2b-8 the tables had none of
 * them, so each was bypassable through PostgREST. Every write below is a real
 * signed-in session (the PostgREST path a browser uses); the service-role
 * client only builds fixtures and reads back the surviving rows.
 *
 * R27: this suite replays the newest file that owns the six role write
 * policies (`alter policy` replaces in place), so the replay list is
 * 20261121150000, not 20261119190000.
 */

const PASSWORD = 'RoleEditorGuards!';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const MIGRATION = 'supabase/migrations/20261121150000_role_editor_guards_rls.sql';
const MIGRATION_SOURCE = readFileSync(MIGRATION, 'utf8');

/**
 * The migration's closing guard (R26), extracted so a test can run it against
 * a weakened schema: it is the last `do $$ … $$;` in the file.
 */
const GUARD_MATCH = MIGRATION_SOURCE.match(/do \$\$[\s\S]*\$\$;\s*$/);
if (!GUARD_MATCH) throw new Error(`${MIGRATION} has no closing guard block`);
const GUARD_BLOCK = GUARD_MATCH[0];

/**
 * The shipped file plus the newest `rls_caller_has_permission` definition (the
 * org_roles policies still call it; 2b-1 owns its body, this file does not
 * re-create it) and its grant, so the replay installs the definition the
 * schema ends up with.
 */
const SHIPPED_SQL = `${MIGRATION_SOURCE}${latestShippedFunction('rls_caller_has_permission')}
grant execute on function public.rls_caller_has_permission(uuid, text) to authenticated;`;

const localDatabaseUrl = (() => {
  const raw = process.env.SUPABASE_DB_URL;
  if (!raw) return null;
  const { hostname } = new URL(raw);
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname) ? raw : null;
})();

/**
 * A run without the direct connection must fail instead of skipping: a silent
 * skip would keep asserting against whatever policies a previous run applied,
 * so a reverted predicate would survive.
 */
function requireLocalDatabaseUrl(): string {
  if (!localDatabaseUrl) {
    throw new Error(
      "org-role-editor-guards-rls needs SUPABASE_DB_URL pointing at this checkout's local " +
        'Supabase to install the shipped policies. Run the suite through ' +
        '`bun run env:run -- bun run test:integration`.',
    );
  }
  return localDatabaseUrl;
}

/**
 * Install the shipped migration the way a reset would. The helpers' grants are
 * revoked first, so the migration's `grant execute` lines are load-bearing: a
 * reset starts from a database where the function does not exist yet, and
 * without this the DB would keep the grant the full suite's reset applied and
 * a deleted grant line would pass (R19).
 */
async function installShippedSql(): Promise<void> {
  const sql = postgres(requireLocalDatabaseUrl(), { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(
      `do $$ begin
         revoke all on function public.rls_caller_may_set_role_permission(uuid, text, text) from public, anon, authenticated, service_role;
         revoke all on function public.rls_caller_covers_permission(uuid, text, text) from public, anon, authenticated, service_role;
         revoke all on function public.rls_caller_has_permission(uuid, text) from public, anon, authenticated, service_role;
       exception when undefined_function then null; end $$;`,
    );
    await sql.unsafe(SHIPPED_SQL);
  } finally {
    await sql.end();
  }
}

function newClient(): SupabaseClient<Database> {
  return createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** The JWT claim payload `auth.uid()` reads when a direct connection sets the role. */
function jwtClaims(userId: string): string {
  return `{"sub":"${userId}","role":"authenticated"}`;
}

async function signIn(email: string): Promise<SupabaseClient<Database>> {
  const client = newClient();
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`signIn failed for ${email}: ${error.message}`);
  return client;
}

describe('role-editor guards at RLS (2b-8)', () => {
  const service = createTypedServiceClient();

  /** Main org: coverage / D16 / D21 fixtures. */
  let orgId: string;
  let adminRoleId: string;
  let teacherRoleId: string;
  let memberRoleId: string;
  /** Empty custom role the coverage writes target; seeded with deck.read@organization. */
  let targetRoleId: string;
  /** Caller holding org.role.manage but deck.read only at own. */
  let ownRoleId: string;
  let ownUser: SupabaseClient<Database>;
  /** Caller holding only org.role.manage. */
  let gateUser: SupabaseClient<Database>;
  /** Caller on the system admin role (org.admin at organization). */
  let adminUser: SupabaseClient<Database>;

  /** Org where the system admin role is the only org.role.manage holder. */
  let lastHolderOrgId: string;
  let lastHolderAdminRoleId: string;
  let lastHolderAdminUser: SupabaseClient<Database>;

  /** Org where a custom role is the only holder; used for the org_roles DELETE trigger. */
  let roleDeleteOrgId: string;
  let lastGateRoleId: string;
  let roleDeleteUser: SupabaseClient<Database>;

  /** Org with exactly two holders, for the concurrency proof. */
  let concOrgId: string;
  let concAdminRoleId: string;
  let concCustomRoleId: string;
  let concAdminUserId: string;
  let concCustomUserId: string;

  const userIds: string[] = [];

  async function createUser(email: string): Promise<string> {
    const { data, error } = await service.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { name: email.split('@')[0], account_type: 'manager' },
    });
    if (error) throw new Error(`createUser ${email} failed: ${error.message}`);
    userIds.push(data.user.id);
    return data.user.id;
  }

  /** A custom role in `organizationId` holding exactly `rows`. */
  async function customRole(
    organizationId: string,
    name: string,
    rows: Record<string, 'own' | 'group' | 'organization'>,
  ): Promise<string> {
    const { data: role, error } = await service
      .from('org_roles')
      .insert({
        organization_id: organizationId,
        name,
        display_name: name,
        description: null,
        is_system: false,
      })
      .select('id')
      .single();
    if (error) throw new Error(`role ${name} create failed: ${error.message}`);
    for (const [permission_key, scope] of Object.entries(rows)) {
      const { error: permissionError } = await service
        .from('org_role_permissions')
        .insert({ org_role_id: role.id, permission_key, scope });
      if (permissionError)
        throw new Error(`permission ${permission_key}: ${permissionError.message}`);
    }
    return role.id;
  }

  async function gateHolderIds(organizationId: string): Promise<string[]> {
    const { data } = await service
      .from('org_role_permissions')
      .select('org_role_id, org_roles!inner(organization_id)')
      .eq('permission_key', 'org.role.manage')
      .eq('org_roles.organization_id', organizationId);
    return (data ?? []).map((row) => row.org_role_id);
  }

  async function storedScope(roleId: string, key: string): Promise<string | null> {
    const { data } = await service
      .from('org_role_permissions')
      .select('scope')
      .eq('org_role_id', roleId)
      .eq('permission_key', key)
      .maybeSingle();
    return data?.scope ?? null;
  }

  beforeAll(async () => {
    // The shipped policies and their grants first: every fixture below is scoped
    // by them. A failed install fails the suite — a reverted predicate must not
    // survive on the policies a previous run applied.
    await installShippedSql();

    // Main org.
    const org = await seedOrganization(`guards-${tag}`);
    orgId = org.org.id;
    adminRoleId = org.adminRoleId;
    teacherRoleId = org.teacherRoleId;
    memberRoleId = org.memberRoleId;

    const gateUserId = await createUser(`gate-${tag}@dev.local`);
    const ownUserId = await createUser(`own-${tag}@dev.local`);
    const adminUserId = await createUser(`admin-${tag}@dev.local`);

    const gateRoleId = await customRole(orgId, `gate-${tag}`, {
      'org.role.manage': 'organization',
    });
    ownRoleId = await customRole(orgId, `own-${tag}`, {
      'org.role.manage': 'organization',
      'deck.read': 'own',
      'deck.update': 'own',
    });

    await seedOrgMembership({ organizationId: orgId, userId: gateUserId, orgRoleId: gateRoleId });
    await seedOrgMembership({ organizationId: orgId, userId: ownUserId, orgRoleId: ownRoleId });
    await seedOrgMembership({ organizationId: orgId, userId: adminUserId, orgRoleId: adminRoleId });

    targetRoleId = await customRole(orgId, `target-${tag}`, {});
    const { error: seedError } = await service.from('org_role_permissions').insert({
      org_role_id: targetRoleId,
      permission_key: 'deck.read',
      scope: 'organization',
    });
    if (seedError) throw new Error(`target seed failed: ${seedError.message}`);

    gateUser = await signIn(`gate-${tag}@dev.local`);
    ownUser = await signIn(`own-${tag}@dev.local`);
    adminUser = await signIn(`admin-${tag}@dev.local`);

    // Org where the system admin role is the only org.role.manage holder.
    const lastOrg = await seedOrganization(`guards-last-${tag}`);
    lastHolderOrgId = lastOrg.org.id;
    lastHolderAdminRoleId = lastOrg.adminRoleId;
    const lastAdminId = await createUser(`last-admin-${tag}@dev.local`);
    await seedOrgMembership({
      organizationId: lastHolderOrgId,
      userId: lastAdminId,
      orgRoleId: lastHolderAdminRoleId,
    });
    lastHolderAdminUser = await signIn(`last-admin-${tag}@dev.local`);

    // Org where a custom role is the only holder (the admin role's gate row is
    // removed with the service client): the org_roles DELETE trigger's fixture.
    const roleDeleteOrg = await seedOrganization(`guards-role-del-${tag}`);
    roleDeleteOrgId = roleDeleteOrg.org.id;
    const { error: dropGateError } = await service
      .from('org_role_permissions')
      .delete()
      .eq('org_role_id', roleDeleteOrg.adminRoleId)
      .eq('permission_key', 'org.role.manage');
    if (dropGateError) throw new Error(`gate row removal failed: ${dropGateError.message}`);
    const roleDeleteUserId = await createUser(`role-del-${tag}@dev.local`);
    lastGateRoleId = await customRole(roleDeleteOrgId, `only-gate-${tag}`, {
      'org.role.manage': 'organization',
    });
    await seedOrgMembership({
      organizationId: roleDeleteOrgId,
      userId: roleDeleteUserId,
      orgRoleId: lastGateRoleId,
    });
    roleDeleteUser = await signIn(`role-del-${tag}@dev.local`);

    // Org with exactly two holders for the concurrency proof: the system admin
    // role and a custom org.admin holder (so self-edit is exempt for both).
    const concOrg = await seedOrganization(`guards-conc-${tag}`);
    concOrgId = concOrg.org.id;
    concAdminRoleId = concOrg.adminRoleId;
    concAdminUserId = await createUser(`conc-a-${tag}@dev.local`);
    concCustomUserId = await createUser(`conc-b-${tag}@dev.local`);
    concCustomRoleId = await customRole(concOrgId, `conc-d-${tag}`, {
      'org.admin': 'organization',
      'org.role.manage': 'organization',
    });
    await seedOrgMembership({
      organizationId: concOrgId,
      userId: concAdminUserId,
      orgRoleId: concAdminRoleId,
    });
    await seedOrgMembership({
      organizationId: concOrgId,
      userId: concCustomUserId,
      orgRoleId: concCustomRoleId,
    });
  });

  afterAll(async () => {
    for (const id of [orgId, lastHolderOrgId, roleDeleteOrgId, concOrgId]) {
      if (id) await cleanupOrganizationDeep(id).catch(() => {});
    }
    for (const id of userIds) {
      if (id) await service.auth.admin.deleteUser(id).catch(() => {});
    }
  });

  it('replays the shipped migration on top of the applied state', async () => {
    // The beforeAll install is the same replay; running it again proves the
    // file is idempotent (alter policy / create or replace / drop-if-exists).
    await expect(installShippedSql()).resolves.toBeUndefined();
  });

  it('refuses to delete a system role through PostgREST and the row survives', async () => {
    // A DELETE filtered by the USING clause answers no error and zero rows —
    // the surviving row is the assertion that matters.
    const { data, error } = await gateUser
      .from('org_roles')
      .delete()
      .in('id', [adminRoleId, teacherRoleId, memberRoleId])
      .select('id');
    expect(error, 'the delete itself does not raise').toBeNull();
    expect(data ?? [], 'no system role row is deleted').toHaveLength(0);

    const { data: survivors } = await service
      .from('org_roles')
      .select('id')
      .in('id', [adminRoleId, teacherRoleId, memberRoleId]);
    expect(survivors ?? []).toHaveLength(3);
  });

  it('refuses to create a system role through PostgREST (INSERT WITH CHECK)', async () => {
    const { error: insertError } = await gateUser.from('org_roles').insert({
      organization_id: orgId,
      name: `fake-system-${tag}`,
      display_name: `fake-system-${tag}`,
      description: null,
      is_system: true,
    });
    expect(insertError?.code, 'INSERT with is_system = true violates WITH CHECK').toBe('42501');
  });

  it('refuses to flip is_system in either direction (the flip trigger, not WITH CHECK)', async () => {
    // The UPDATE policy carries no `not is_system` conjunct (it would refuse
    // every legitimate edit of a system row), so the flip is refused by the
    // guard_org_role_system_flip trigger instead.
    const { error: toSystem } = await gateUser
      .from('org_roles')
      .update({ is_system: true })
      .eq('id', targetRoleId);
    expect(toSystem?.code, 'custom -> system is refused by the flip trigger').toBe('42501');
    expect(toSystem?.message).toContain('flipped into or out of system roles');

    const { error: fromSystem } = await gateUser
      .from('org_roles')
      .update({ is_system: false })
      .eq('id', teacherRoleId);
    expect(fromSystem?.code, 'system -> custom is refused too').toBe('42501');

    const { data: rows } = await service
      .from('org_roles')
      .select('id, is_system')
      .in('id', [targetRoleId, teacherRoleId]);
    const byId = new Map((rows ?? []).map((r) => [r.id, r.is_system]));
    expect(byId.get(targetRoleId) ?? false, 'the target role is still a custom one').toBe(false);
    expect(byId.get(teacherRoleId) ?? false, 'the system role is still a system one').toBe(true);
  });

  it("lets an org.role.manage holder edit a system role's description (positive control)", async () => {
    // updateRole only forbids renaming a system role; description/display_name/
    // entitlement_profile edits must pass RLS and persist.
    const description = `edited-${tag}`;
    const { data, error } = await gateUser
      .from('org_roles')
      .update({ description })
      .eq('id', teacherRoleId)
      .select('id, description')
      .single();
    expect(error, 'the description edit passes USING + WITH CHECK').toBeNull();
    expect(data?.description).toBe(description);

    const { data: persisted } = await service
      .from('org_roles')
      .select('description')
      .eq('id', teacherRoleId)
      .single();
    expect(persisted?.description, 'the edit persists').toBe(description);
  });

  it('refuses to rename a system role (the 20261024 identity trigger)', async () => {
    // The rename half of "system roles cannot be renamed" already lives at the
    // data plane in guard_system_org_role_identity; this pins it so 2b-8 does
    // not silently drop it.
    const { error } = await gateUser
      .from('org_roles')
      .update({ name: `renamed-${tag}` })
      .eq('id', teacherRoleId);
    expect(error?.code).toBe('42501');
    expect(error?.message).toContain('system org roles cannot be renamed or moved');
  });

  it('refuses to grant a key at a scope the caller does not hold', async () => {
    // ownUser holds deck.read at own only: organization is beyond that authority.
    const { error: widerError } = await ownUser.from('org_role_permissions').insert({
      org_role_id: targetRoleId,
      permission_key: 'deck.read',
      scope: 'organization',
    });
    expect(widerError?.code, 'deck.read@organization needs an organization-scope grant').toBe(
      '42501',
    );

    const { error: unheldError } = await ownUser.from('org_role_permissions').insert({
      org_role_id: targetRoleId,
      permission_key: 'org.seat.manage',
      scope: 'organization',
    });
    expect(unheldError?.code, 'a key the caller does not hold at all cannot be granted').toBe(
      '42501',
    );
  });

  it('allows granting and removing at a covered scope (positive control)', async () => {
    // ownUser holds deck.update at own, so deck.update@own on another role is
    // within authority — the fixture differs from the refused case above.
    const { error: insertError } = await ownUser.from('org_role_permissions').insert({
      org_role_id: targetRoleId,
      permission_key: 'deck.update',
      scope: 'own',
    });
    expect(insertError, 'deck.update@own is covered by the caller own scope').toBeNull();

    const { error: deleteError } = await ownUser
      .from('org_role_permissions')
      .delete()
      .eq('org_role_id', targetRoleId)
      .eq('permission_key', 'deck.update');
    expect(deleteError, 'removing a row stored at own is covered too').toBeNull();
    expect(await storedScope(targetRoleId, 'deck.update')).toBeNull();
  });

  it('refuses to delete or update a stored row whose scope the caller does not cover', async () => {
    // The target role's deck.read row is stored at organization; ownUser holds
    // the key only at own.
    const { data: deleted, error: deleteError } = await ownUser
      .from('org_role_permissions')
      .delete()
      .eq('org_role_id', targetRoleId)
      .eq('permission_key', 'deck.read')
      .select('id');
    expect(deleteError).toBeNull();
    expect(deleted ?? [], 'the organization-scope row is filtered out').toHaveLength(0);
    expect(await storedScope(targetRoleId, 'deck.read')).toBe('organization');

    const { data: updated, error: updateError } = await ownUser
      .from('org_role_permissions')
      .update({ scope: 'own' })
      .eq('org_role_id', targetRoleId)
      .eq('permission_key', 'deck.read')
      .select('id');
    expect(updateError).toBeNull();
    expect(updated ?? [], 'the UPDATE USING clause hides the row').toHaveLength(0);
    expect(await storedScope(targetRoleId, 'deck.read')).toBe('organization');
  });

  it('refuses self-edit without org.admin', async () => {
    // ownUser's own role holds deck.read@own, so coverage would allow it — the
    // self-edit rule is what refuses.
    const { data, error } = await ownUser
      .from('org_role_permissions')
      .delete()
      .eq('org_role_id', ownRoleId)
      .eq('permission_key', 'deck.read')
      .select('id');
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
    expect(await storedScope(ownRoleId, 'deck.read')).toBe('own');
  });

  it('lets an org.admin holder edit their own role (D21)', async () => {
    const { data, error } = await adminUser
      .from('org_role_permissions')
      .update({ scope: 'group' })
      .eq('org_role_id', adminRoleId)
      .eq('permission_key', 'deck.read')
      .select('id');
    expect(error, 'the ownership exemption lifts the self-edit refusal').toBeNull();
    expect(data ?? []).toHaveLength(1);
    expect(await storedScope(adminRoleId, 'deck.read')).toBe('group');
  });

  it('never lets org.admin be granted, moved into, or withdrawn through PostgREST (D16)', async () => {
    const { error: insertError } = await gateUser.from('org_role_permissions').insert({
      org_role_id: targetRoleId,
      permission_key: 'org.admin',
      scope: 'organization',
    });
    expect(insertError?.code, 'org.admin is not assignable').toBe('42501');

    // Even an org.admin holder: the assignable check precedes the exemption.
    const { error: updateError } = await adminUser
      .from('org_role_permissions')
      .update({ permission_key: 'org.admin' })
      .eq('org_role_id', targetRoleId)
      .eq('permission_key', 'deck.read');
    expect(updateError?.code, 'org.admin cannot be written into existence').toBe('42501');

    const { data: deleted, error: deleteError } = await adminUser
      .from('org_role_permissions')
      .delete()
      .eq('org_role_id', adminRoleId)
      .eq('permission_key', 'org.admin')
      .select('id');
    expect(deleteError).toBeNull();
    expect(deleted ?? [], 'withdrawing the stored org.admin row is refused too').toHaveLength(0);
    expect(await storedScope(adminRoleId, 'org.admin')).toBe('organization');
  });

  it('refuses to remove the last org.role.manage holder row (trigger, not a USING subquery)', async () => {
    expect(await gateHolderIds(lastHolderOrgId)).toEqual([lastHolderAdminRoleId]);

    const { error } = await lastHolderAdminUser
      .from('org_role_permissions')
      .delete()
      .eq('org_role_id', lastHolderAdminRoleId)
      .eq('permission_key', 'org.role.manage');
    expect(error?.code).toBe('42501');
    expect(error?.message).toContain('last org.role.manage holder');
    expect(await gateHolderIds(lastHolderOrgId)).toEqual([lastHolderAdminRoleId]);
  });

  it('refuses to move the gate key away from the last holder', async () => {
    const { error } = await lastHolderAdminUser
      .from('org_role_permissions')
      .update({ permission_key: 'deck.read' })
      .eq('org_role_id', lastHolderAdminRoleId)
      .eq('permission_key', 'org.role.manage');
    expect(error?.code).toBe('42501');
    expect(error?.message).toContain('last org.role.manage holder');
    expect(await storedScope(lastHolderAdminRoleId, 'org.role.manage')).toBe('organization');
  });

  it('allows the removal once a second holder exists (positive control)', async () => {
    const secondRoleId = await customRole(lastHolderOrgId, `second-${tag}`, {
      'org.role.manage': 'organization',
    });
    expect(new Set(await gateHolderIds(lastHolderOrgId))).toEqual(
      new Set([lastHolderAdminRoleId, secondRoleId]),
    );

    const { error } = await lastHolderAdminUser
      .from('org_role_permissions')
      .delete()
      .eq('org_role_id', lastHolderAdminRoleId)
      .eq('permission_key', 'org.role.manage');
    expect(error, 'with a second holder the delete goes through').toBeNull();
    expect(await gateHolderIds(lastHolderOrgId)).toEqual([secondRoleId]);
  });

  it('refuses to delete the last gate-holder role itself (org_roles trigger)', async () => {
    expect(await gateHolderIds(roleDeleteOrgId)).toEqual([lastGateRoleId]);

    const { error } = await roleDeleteUser.from('org_roles').delete().eq('id', lastGateRoleId);
    expect(error?.code).toBe('42501');
    expect(error?.message).toContain('last org.role.manage holder');

    const { data: survivor } = await service
      .from('org_roles')
      .select('id')
      .eq('id', lastGateRoleId);
    expect(survivor ?? []).toHaveLength(1);
  });

  it('allows deleting a gate-holder role when another holder remains', async () => {
    const otherRoleId = await customRole(roleDeleteOrgId, `other-gate-${tag}`, {
      'org.role.manage': 'organization',
    });

    const { error } = await roleDeleteUser.from('org_roles').delete().eq('id', otherRoleId);
    expect(error, 'the second holder keeps the gate alive').toBeNull();

    const { data: gone } = await service.from('org_roles').select('id').eq('id', otherRoleId);
    expect(gone ?? []).toHaveLength(0);
    expect(await gateHolderIds(roleDeleteOrgId)).toEqual([lastGateRoleId]);
  });

  it('serializes two concurrent removals of the last two holders (R29)', async () => {
    // Two sessions, each an org.admin holder whose own role holds the gate:
    // both pass RLS (self-edit exempt, scope covered), so the refusal can only
    // come from the trigger — and the org-row FOR UPDATE lock is what makes the
    // loser's count see the winner's committed delete.
    expect(new Set(await gateHolderIds(concOrgId))).toEqual(
      new Set([concAdminRoleId, concCustomRoleId]),
    );

    const sessionA = postgres(requireLocalDatabaseUrl(), { max: 1, onnotice: () => {} });
    const sessionB = postgres(requireLocalDatabaseUrl(), { max: 1, onnotice: () => {} });
    try {
      await sessionA.unsafe(
        `set role authenticated; set request.jwt.claims = '${jwtClaims(concAdminUserId)}'`,
      );
      await sessionB.unsafe(
        `set role authenticated; set request.jwt.claims = '${jwtClaims(concCustomUserId)}'`,
      );
      await sessionA.unsafe('begin');
      await sessionB.unsafe('begin');

      const deleteA = sessionA.unsafe(
        `delete from public.org_role_permissions where org_role_id = '${concAdminRoleId}' and permission_key = 'org.role.manage'`,
      );
      const deleteB = sessionB.unsafe(
        `delete from public.org_role_permissions where org_role_id = '${concCustomRoleId}' and permission_key = 'org.role.manage'`,
      );

      // The first delete to finish holds the org-row lock; the other statement
      // is still blocked, which is the serialization itself.
      const winner = await Promise.race([
        deleteA.then(
          () => 'A' as const,
          () => 'A' as const,
        ),
        deleteB.then(
          () => 'B' as const,
          () => 'B' as const,
        ),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 300));
      if (winner === 'A') {
        await sessionA.unsafe('commit');
        await sessionB.unsafe('rollback');
      } else {
        await sessionB.unsafe('commit');
        await sessionA.unsafe('rollback');
      }

      const [resultA, resultB] = await Promise.allSettled([deleteA, deleteB]);
      const fulfilled = [resultA, resultB].filter((r) => r.status === 'fulfilled');
      const rejected = [resultA, resultB].filter((r) => r.status === 'rejected');
      expect(fulfilled, 'exactly one of the two deletes commits').toHaveLength(1);
      expect(rejected, 'the loser is refused by the last-holder guard').toHaveLength(1);
      const reason: unknown = rejected[0]?.reason;
      expect(reason instanceof Error ? reason.message : '').toContain(
        'last org.role.manage holder',
      );

      // At least one holder row survives — the org can still manage roles.
      expect(await gateHolderIds(concOrgId)).toHaveLength(1);
    } finally {
      await sessionA.end();
      await sessionB.end();
    }
  });

  it('raises when the DELETE policy loses its is_system conjunct (R26)', async () => {
    const sql = postgres(requireLocalDatabaseUrl(), { max: 1, onnotice: () => {} });
    try {
      // Weaken the shipped delete policy back to the pre-2b-8 predicate.
      await sql.unsafe(
        `alter policy "Org managers delete roles" on public.org_roles
           using (organization_id in (select c.organization_id from public.rls_caller_org_ids() c)
                  and public.rls_caller_has_permission(organization_id, 'org.role.manage'))`,
      );
      await expect(sql.unsafe(GUARD_BLOCK)).rejects.toThrow(
        /DELETE using lost .* is_system conjunct/,
      );
    } finally {
      // Restore the shipped state for the remaining tests.
      await sql.unsafe(SHIPPED_SQL);
      await sql.end();
    }
  });

  it('raises when the UPDATE with_check loses its gate (R26)', async () => {
    const sql = postgres(requireLocalDatabaseUrl(), { max: 1, onnotice: () => {} });
    try {
      // Keep the USING clause intact, drop the gate from WITH CHECK only — a
      // clause-blind guard would pass on the concatenation.
      await sql.unsafe(
        `alter policy "Org managers update roles" on public.org_roles
           using (organization_id in (select c.organization_id from public.rls_caller_org_ids() c)
                  and public.rls_caller_has_permission(organization_id, 'org.role.manage'))
           with check (organization_id in (select c.organization_id from public.rls_caller_org_ids() c))`,
      );
      await expect(sql.unsafe(GUARD_BLOCK)).rejects.toThrow(
        /UPDATE with_check lost the tenant floor or the org.role.manage gate/,
      );
    } finally {
      await sql.unsafe(SHIPPED_SQL);
      await sql.end();
    }
  });

  it('raises when the UPDATE policy regains the is_system conjunct (R26)', async () => {
    const sql = postgres(requireLocalDatabaseUrl(), { max: 1, onnotice: () => {} });
    try {
      // The pre-fix shape: a WITH CHECK on the new row refuses every edit of a
      // system role, so the guard pins its absence.
      await sql.unsafe(
        `alter policy "Org managers update roles" on public.org_roles
           using (organization_id in (select c.organization_id from public.rls_caller_org_ids() c)
                  and public.rls_caller_has_permission(organization_id, 'org.role.manage'))
           with check (organization_id in (select c.organization_id from public.rls_caller_org_ids() c)
                  and public.rls_caller_has_permission(organization_id, 'org.role.manage')
                  and not coalesce(is_system, false))`,
      );
      await expect(sql.unsafe(GUARD_BLOCK)).rejects.toThrow(
        /UPDATE policy carries the is_system conjunct/,
      );
    } finally {
      await sql.unsafe(SHIPPED_SQL);
      await sql.end();
    }
  });

  it('raises when the org_role_permissions UPDATE loses the helper from one clause (R26)', async () => {
    const sql = postgres(requireLocalDatabaseUrl(), { max: 1, onnotice: () => {} });
    try {
      await sql.unsafe(
        `alter policy "Org managers update role permissions" on public.org_role_permissions
           using (public.rls_caller_may_set_role_permission(org_role_id, permission_key, scope))
           with check (true)`,
      );
      await expect(sql.unsafe(GUARD_BLOCK)).rejects.toThrow(
        /UPDATE must carry the §4.4 helper in both using and with_check/,
      );
    } finally {
      await sql.unsafe(SHIPPED_SQL);
      await sql.end();
    }
  });

  it('raises when a last-holder guard trigger is dropped (R26)', async () => {
    const sql = postgres(requireLocalDatabaseUrl(), { max: 1, onnotice: () => {} });
    try {
      await sql.unsafe(
        'drop trigger if exists guard_org_role_permissions_last_role_manage_holder on public.org_role_permissions',
      );
      await expect(sql.unsafe(GUARD_BLOCK)).rejects.toThrow(/last-holder guard triggers/);
    } finally {
      await sql.unsafe(SHIPPED_SQL);
      await sql.end();
    }
  });

  it('raises when the system-flip guard trigger is dropped (R26)', async () => {
    const sql = postgres(requireLocalDatabaseUrl(), { max: 1, onnotice: () => {} });
    try {
      await sql.unsafe('drop trigger if exists guard_org_role_system_flip on public.org_roles');
      await expect(sql.unsafe(GUARD_BLOCK)).rejects.toThrow(/guard_org_role_system_flip/);
    } finally {
      await sql.unsafe(SHIPPED_SQL);
      await sql.end();
    }
  });
});
