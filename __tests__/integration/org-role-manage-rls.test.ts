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
 * RLS parity for the `org.role.manage` gate (ADR-0015 §4.4, R4).
 *
 * The role write routes gate on the permission, so the table must too: before
 * this migration the policy asked `is_org_manager` (a `member.manage` feature),
 * which meant a custom role holding `org.role.manage` passed the API and was
 * refused by RLS — reachable through PostgREST, not only through a UI bug.
 *
 * Both directions are pinned with real signed-in sessions (the PostgREST path a
 * browser uses): the permission holder may write, and a role that holds only an
 * entitlement row (not the permission) may not. The control is what proves the
 * predicate moved rather than widened.
 */

const PASSWORD = 'RoleManageRls!';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const MIGRATION = 'supabase/migrations/20261119190000_org_role_manage_rls.sql';

/**
 * The 2a-2 file, with the one definition phase 2b moved.
 *
 * Its helper body reads `permission_name`, which phase 2b renamed; replaying the
 * file as shipped would install a helper that fails on its first read (the 2b
 * migration re-creates the same helper against the new column). The helper is
 * therefore stripped here and installed from the migration that defines it last,
 * so the policies pinned below stay the shipped 2a-2 policies.
 */
const SHIPPED_SQL = `${readFileSync(MIGRATION, 'utf8').replace(
  /create or replace function public\.rls_caller_has_permission[\s\S]*?\$\$;\n/,
  '',
)}${latestShippedFunction('rls_caller_has_permission')}
grant execute on function public.rls_caller_has_permission(uuid, text) to authenticated;`;

const localDatabaseUrl = (() => {
  const raw = process.env.SUPABASE_DB_URL;
  if (!raw) return null;
  const { hostname } = new URL(raw);
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname) ? raw : null;
})();

/**
 * The database URL the install needs: the local stack's, from the same environment
 * `bun run env:run` exports. A run without it must fail instead of skipping — a
 * silent skip would keep asserting against whatever policies a previous run applied,
 * so a reverted predicate would survive.
 */
function requireLocalDatabaseUrl(): string {
  if (!localDatabaseUrl) {
    throw new Error(
      "org-role-manage-rls needs SUPABASE_DB_URL pointing at this checkout's local " +
        'Supabase to install the shipped policies. Run the suite through ' +
        '`bun run env:run -- bun run test:integration`: a bare `bun run test:integration` ' +
        'in a fresh worktree has no database URL, and skipping the install would let a ' +
        'reverted predicate pass.',
    );
  }
  return localDatabaseUrl;
}

/**
 * Install the shipped migration the way a reset would.
 *
 * The mutation gate edits the migration file, and without the install the suite
 * would keep asserting against the policies a previous run applied — a reverted
 * predicate would survive. The reset's own grant is revoked first so the
 * migration's `grant execute` is load-bearing: a reset starts from a database
 * where the function does not exist yet, and without this the DB would keep the
 * grant the full suite's reset applied and a deleted grant line would pass.
 */
async function installShippedSql(): Promise<void> {
  const sql = postgres(requireLocalDatabaseUrl(), { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(
      'revoke all on function public.rls_caller_has_permission(uuid, text) from authenticated',
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

async function signIn(email: string): Promise<SupabaseClient<Database>> {
  const client = newClient();
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`signIn failed for ${email}: ${error.message}`);
  return client;
}

/** The `org_roles` INSERT error a session gets, or `null` when the policy allows it. */
async function orgRoleInsertError(
  session: SupabaseClient<Database>,
  organizationId: string,
  name: string,
) {
  const { error } = await session.from('org_roles').insert({
    organization_id: organizationId,
    name,
    display_name: name,
    description: null,
    is_system: false,
  });
  return error;
}

describe('org.role.manage RLS predicate', () => {
  const service = createTypedServiceClient();

  let orgId: string;
  let foreignOrgId: string;
  let roleHolderId: string;
  let managerFeatureHolderId: string;
  /** Empty custom roles the two sessions write permission rows against. */
  let roleHolderTargetId: string;
  let managerFeatureHolderTargetId: string;

  let roleHolder: SupabaseClient<Database>;
  let managerFeatureHolder: SupabaseClient<Database>;

  async function createUser(email: string, label: string): Promise<string> {
    const { data, error } = await service.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { name: label, account_type: 'manager' },
    });
    if (error) throw new Error(`createUser ${label} failed: ${error.message}`);
    return data.user.id;
  }

  /** A custom role in `organizationId` holding exactly `permission`, at organization scope. */
  async function customRole(
    organizationId: string,
    name: string,
    permission: string | null,
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

    if (permission) {
      const { error: permissionError } = await service.from('org_role_permissions').insert({
        org_role_id: role.id,
        permission_key: permission,
        scope: 'organization',
      });
      if (permissionError) {
        throw new Error(`permission for ${name} failed: ${permissionError.message}`);
      }
    }

    return role.id;
  }

  beforeAll(async () => {
    // The shipped policies and their grants first: every fixture below is scoped
    // by them.
    await installShippedSql();

    const org = await seedOrganization(`role-manage-${tag}`);
    orgId = org.org.id;
    const foreignOrg = await seedOrganization(`role-manage-foreign-${tag}`);
    foreignOrgId = foreignOrg.org.id;

    roleHolderId = await createUser(`role-holder-${tag}@dev.local`, 'role holder');
    managerFeatureHolderId = await createUser(
      `manager-feature-${tag}@dev.local`,
      'manager feature holder',
    );

    const roleHolderRole = await customRole(orgId, `role-holder-${tag}`, 'org.role.manage');
    const managerFeatureRole = await customRole(orgId, `manager-feature-${tag}`, null);

    // The control reads an entitlement row, not the permission: a custom role
    // granted `branding` through `org_role_features`. The row branch of
    // `has_org_feature` still honours it, but no role-write policy asks for an
    // entitlement any more, so the role must lose the write to the permission.
    const { error: featureError } = await service.from('org_role_features').insert({
      org_role_id: managerFeatureRole,
      feature_key: 'branding',
      is_enabled: true,
    });
    if (featureError) throw new Error(`feature grant failed: ${featureError.message}`);

    await seedOrgMembership({
      organizationId: orgId,
      userId: roleHolderId,
      orgRoleId: roleHolderRole,
    });
    await seedOrgMembership({
      organizationId: orgId,
      userId: managerFeatureHolderId,
      orgRoleId: managerFeatureRole,
    });

    // Targets for the permission-row policies: empty custom roles, so the
    // inserts below cannot collide with a seeded row.
    roleHolderTargetId = await customRole(orgId, `target-role-manage-${tag}`, null);
    managerFeatureHolderTargetId = await customRole(orgId, `target-member-manage-${tag}`, null);

    roleHolder = await signIn(`role-holder-${tag}@dev.local`);
    managerFeatureHolder = await signIn(`manager-feature-${tag}@dev.local`);
  });

  afterAll(async () => {
    await cleanupOrganizationDeep(orgId).catch(() => {});
    await cleanupOrganizationDeep(foreignOrgId).catch(() => {});
    for (const id of [roleHolderId, managerFeatureHolderId]) {
      if (id) await service.auth.admin.deleteUser(id).catch(() => {});
    }
  });

  it('lets an org.role.manage holder create, update and delete a role', async () => {
    const { data: created, error: insertError } = await roleHolder
      .from('org_roles')
      .insert({
        organization_id: orgId,
        name: `created-by-role-holder-${tag}`,
        display_name: `created-by-role-holder-${tag}`,
        description: null,
        is_system: false,
      })
      .select('id');
    expect(insertError, 'INSERT is allowed by the permission predicate').toBeNull();
    expect(created).toHaveLength(1);

    const roleId = created![0]!.id;
    const { error: updateError } = await roleHolder
      .from('org_roles')
      .update({ description: 'renamed' })
      .eq('id', roleId);
    expect(updateError, 'UPDATE is allowed by the permission predicate').toBeNull();

    const { error: deleteError } = await roleHolder.from('org_roles').delete().eq('id', roleId);
    expect(deleteError, 'DELETE is allowed by the permission predicate').toBeNull();
  });

  it('lets an authenticated session execute the RLS helper the policies call', async () => {
    // The migration grants EXECUTE to `authenticated` itself, and nothing runs
    // after it on a reset that could repair a forgotten grant, so a helper the
    // policies call but the migration does not grant answers 42501 — the
    // reset-only 403 on role writes that the dev seed used to mask (R19). Both
    // directions prove it is a real predicate call: true for the permission
    // holder, false for the role that only holds the legacy manager feature.
    const holder = await roleHolder.rpc('rls_caller_has_permission', {
      p_organization_id: orgId,
      p_permission: 'org.role.manage',
    });
    expect(holder.error, 'authenticated may execute rls_caller_has_permission').toBeNull();
    expect(holder.data, 'the holder satisfies its own predicate').toBe(true);

    const control = await managerFeatureHolder.rpc('rls_caller_has_permission', {
      p_organization_id: orgId,
      p_permission: 'org.role.manage',
    });
    expect(control.error, 'the control may execute it too').toBeNull();
    expect(control.data, 'the control does not hold org.role.manage').toBe(false);
  });

  it('lets an org.role.manage holder write the role permission rows', async () => {
    const { error: insertError } = await roleHolder.from('org_role_permissions').insert({
      org_role_id: roleHolderTargetId,
      permission_key: 'deck.read',
      scope: 'own',
    });
    expect(insertError, 'INSERT is allowed by the permission predicate').toBeNull();

    const { error: updateError } = await roleHolder
      .from('org_role_permissions')
      .update({ scope: 'group' })
      .eq('org_role_id', roleHolderTargetId)
      .eq('permission_key', 'deck.read');
    expect(updateError, 'UPDATE is allowed by the permission predicate').toBeNull();

    const { error: deleteError } = await roleHolder
      .from('org_role_permissions')
      .delete()
      .eq('org_role_id', roleHolderTargetId)
      .eq('permission_key', 'deck.read');
    expect(deleteError, 'DELETE is allowed by the permission predicate').toBeNull();
  });

  it('still refuses a role that holds only an entitlement row, not the permission', async () => {
    // Prove the control actually holds the entitlement, so the 42501 below
    // is the moved predicate and not a role with no authority at all.
    const { data: legacyManager } = await managerFeatureHolder.rpc('rls_caller_has_org_feature', {
      p_organization_id: orgId,
      p_feature: 'branding',
    });
    expect(legacyManager, 'the control holds the branding entitlement row').toBe(true);

    const error = await orgRoleInsertError(
      managerFeatureHolder,
      orgId,
      `denied-manager-feature-${tag}`,
    );
    expect(error?.code, 'org_roles INSERT needs org.role.manage, not an entitlement').toBe('42501');

    const { error: permissionError } = await managerFeatureHolder
      .from('org_role_permissions')
      .insert({
        org_role_id: managerFeatureHolderTargetId,
        permission_key: 'deck.read',
        scope: 'own',
      });
    expect(
      permissionError?.code,
      'org_role_permissions INSERT needs org.role.manage, not an entitlement',
    ).toBe('42501');
  });

  it('keeps the tenant scope: the permission only reaches the caller own organizations', async () => {
    const error = await orgRoleInsertError(roleHolder, foreignOrgId, `cross-org-${tag}`);

    expect(error?.code, 'the role write is scoped to rls_caller_org_ids()').toBe('42501');
  });
});
