import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { SYSTEM_ROLE_NAMES, SYSTEM_ROLE_TEMPLATES, type SystemRoleName } from '@studiq/authz';
import { dbRows } from '@studiq/server/lib/supabase/rows';
import type { Database } from '@studiq/server/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupOrganizationDeep, useRealSupabase } from '#test/integration/helpers';
import { createTypedServiceClient, latestShippedFunction } from '#test/integration/test-utils';

// Phase 2a-1 (ADR-0015 §5.3, D18/D19): the role profile is the entitlement
// subject. The trigger writes admin/teacher `all`, member `learner` and custom
// `none`, and `seed_system_role_permissions()` mirrors
// `SYSTEM_ROLE_TEMPLATES`. Since 2b-7 the four legacy management markers are
// gone from the catalog, so the profile governs every key and the `all` branch
// is the plan ceiling alone. Phase 7 dropped the legacy RLS twin; the live
// resolution path is covered by `entitlement-org-resolution-rls.test.ts`.

const MIGRATION = 'supabase/migrations/20261119180000_authority_entitlement_profile.sql';
/** Phase 3d: the teacher read-scope backfill lives in its own file. */
const TEACHER_READ_MIGRATION = 'supabase/migrations/20261122140000_teacher_group_reads.sql';

/**
 * A shipped function, read from the migrations verbatim and installed over the
 * direct connection. A copy here could pass while production ships something
 * else, and a mutation to a migration has to reach the database to turn these
 * tests red. The newest definition wins, because a later migration can re-create
 * one of these functions (`20261119211000` does, for the renamed column).
 */
function shippedFunction(name: string): string {
  return latestShippedFunction(name);
}

const BACKFILL = (() => {
  const source = readFileSync(MIGRATION, 'utf8');
  const start = source.indexOf('update public.org_roles\nset entitlement_profile');
  if (start < 0) throw new Error(`${MIGRATION} has no profile backfill`);
  const end = source.indexOf(';', start);
  return source.slice(start, end + 1);
})();

/**
 * The 3d data migration, read from its file: a re-seed never rewrites an
 * existing Teacher row (`on conflict do nothing` is load-bearing), so this
 * statement is what moves a live system role to the new scope.
 */
const TEACHER_READ_BACKFILL = (() => {
  const source = readFileSync(TEACHER_READ_MIGRATION, 'utf8');
  const start = source.indexOf('update public.org_role_permissions as orp');
  if (start < 0) throw new Error(`${TEACHER_READ_MIGRATION} has no teacher read backfill`);
  const end = source.indexOf(';', start);
  return source.slice(start, end + 1);
})();

const localDatabaseUrl = (() => {
  const raw = process.env.SUPABASE_DB_URL;
  if (!raw) return null;
  const { hostname } = new URL(raw);
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname) ? raw : null;
})();

async function runDirect(statement: string): Promise<void> {
  const sql = postgres(localDatabaseUrl!, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(statement);
  } finally {
    await sql.end();
  }
}
describe('org_roles.entitlement_profile', () => {
  const tag = `${crypto.randomUUID().slice(0, 8)}-${Date.now()}`;

  let service: SupabaseClient<Database>;
  let orgId: string;
  let customRoleId: string;

  async function roleId(roleName: SystemRoleName): Promise<string> {
    const { data, error } = await service
      .from('org_roles')
      .select('id')
      .eq('organization_id', orgId)
      .eq('name', roleName)
      .single();
    if (error) throw new Error(`role ${roleName} not found: ${error.message}`);
    return data.id;
  }

  async function roleScopes(role: SystemRoleName): Promise<Record<string, string>> {
    const { data, error } = await service
      .from('org_role_permissions')
      .select('permission_key, scope')
      .eq('org_role_id', await roleId(role));
    if (error) throw new Error(`permissions read failed: ${error.message}`);
    return Object.fromEntries(dbRows(data).map((row) => [row.permission_key, row.scope]));
  }

  async function profileOf(roleIdToRead: string): Promise<string | null> {
    const { data, error } = await service
      .from('org_roles')
      .select('entitlement_profile')
      .eq('id', roleIdToRead)
      .single();
    if (error) throw new Error(`profile read failed: ${error.message}`);
    return data.entitlement_profile;
  }

  beforeAll(async () => {
    useRealSupabase();
    service = createTypedServiceClient();

    // Install the shipped definitions over the direct connection (see above).
    // The trigger is installed too, so a migration mutation to the profile write
    // reaches the organization created below.
    if (localDatabaseUrl) {
      await runDirect(shippedFunction('seed_system_role_permissions'));
      await runDirect(shippedFunction('handle_new_organization'));
    }

    const { data: org, error: orgError } = await service
      .from('organizations')
      .insert({ name: `profile-org-${tag}` })
      .select('id')
      .single();
    if (orgError) throw new Error(`org create failed: ${orgError.message}`);
    orgId = org.id;

    // A hub org so the ceiling is wider than the learner set.
    const { error: planError } = await service
      .from('organizations')
      .update({ plan: 'hub' })
      .eq('id', orgId);
    if (planError) throw new Error(`plan update failed: ${planError.message}`);

    const { data: customRole, error: customError } = await service
      .from('org_roles')
      .insert({
        organization_id: orgId,
        name: `custom-${tag}`,
        display_name: 'Custom',
        description: null,
        is_system: false,
      })
      .select('id')
      .single();
    if (customError) throw new Error(`custom role create failed: ${customError.message}`);
    customRoleId = customRole.id;
  });

  afterAll(async () => {
    if (orgId) await cleanupOrganizationDeep(orgId).catch(() => {});
  });

  it('the trigger writes all/learner profiles for the system roles and none for a custom role', async () => {
    const profiles = await Promise.all(
      SYSTEM_ROLE_NAMES.map(async (role) => [role, await profileOf(await roleId(role))] as const),
    );

    expect(Object.fromEntries(profiles)).toEqual({
      admin: 'all',
      teacher: 'all',
      member: 'learner',
    });
    expect(await profileOf(customRoleId)).toBe('none');
  });

  it('the column check rejects a fourth value', async () => {
    const { error } = await service
      .from('org_roles')
      .update({ entitlement_profile: 'teacher' })
      .eq('id', customRoleId);
    expect(error?.code).toBe('23514');
  });

  it('seed_system_role_permissions is idempotent', async () => {
    const before = await service
      .from('org_role_permissions')
      .select('id', { count: 'exact', head: true })
      .in('org_role_id', await Promise.all(SYSTEM_ROLE_NAMES.map(roleId)));

    const first = await service.rpc('seed_system_role_permissions', { p_org_id: orgId });
    const second = await service.rpc('seed_system_role_permissions', { p_org_id: orgId });
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();

    const after = await service
      .from('org_role_permissions')
      .select('id', { count: 'exact', head: true })
      .in('org_role_id', await Promise.all(SYSTEM_ROLE_NAMES.map(roleId)));
    expect(after.count).toBe(before.count);
  });

  it.skipIf(!localDatabaseUrl)(
    'the one-time backfill restores all/learner for the system roles, and leaves a custom role alone',
    async () => {
      const systemRoleIds = await Promise.all(SYSTEM_ROLE_NAMES.map(roleId));
      const { error: resetError } = await service
        .from('org_roles')
        .update({ entitlement_profile: 'none' })
        .in('id', [...systemRoleIds, customRoleId]);
      expect(resetError).toBeNull();

      await runDirect(BACKFILL);

      expect(await profileOf(await roleId('admin'))).toBe('all');
      expect(await profileOf(await roleId('teacher'))).toBe('all');
      expect(await profileOf(await roleId('member'))).toBe('learner');
      expect(await profileOf(customRoleId)).toBe('none');
    },
  );

  it('seeds exactly the SYSTEM_ROLE_TEMPLATES matrix, with the ADR §4.2 spot checks', async () => {
    for (const role of SYSTEM_ROLE_NAMES) {
      expect(await roleScopes(role), role).toEqual(SYSTEM_ROLE_TEMPLATES[role].permissions);
    }

    const admin = await roleScopes('admin');
    expect(admin['org.role.manage']).toBe('organization');
    expect(admin['group.invite']).toBe('organization');
    expect(admin['org.admin']).toBe('organization');

    const member = await roleScopes('member');
    expect(Object.keys(member).filter((key) => key.startsWith('assignment.'))).toEqual([]);
    expect(member['stats.read']).toBe('own');
    expect(member['group.read']).toBe('group');
    expect(member['flashcard.read']).toBe('group');
    expect(member['flashcard.create']).toBe('own');

    const teacher = await roleScopes('teacher');
    expect(teacher['stats.read']).toBe('group');
    // D29: content reads are group-scoped (group ⊇ own in the API layer),
    // writes stay own. `assignment.read` moves with the other reads.
    expect(teacher['flashcard.read']).toBe('group');
    expect(teacher['flashcard.create']).toBe('own');
    expect(teacher['assignment.read']).toBe('group');
    expect(teacher['assignment.update']).toBe('own');
    expect(teacher['group.manage']).toBe('group');
  });

  it.skipIf(!localDatabaseUrl)(
    'the 3d backfill moves an existing Teacher read to group and leaves a custom role alone',
    async () => {
      const teacherRole = await roleId('teacher');
      const { error: teacherError } = await service
        .from('org_role_permissions')
        .update({ scope: 'own' })
        .eq('org_role_id', teacherRole)
        .eq('permission_key', 'flashcard.read');
      expect(teacherError).toBeNull();

      const { error: customError } = await service.from('org_role_permissions').insert({
        org_role_id: customRoleId,
        permission_key: 'flashcard.read',
        scope: 'own',
      });
      expect(customError).toBeNull();

      // The excluded roles must keep whatever they carry: put Admin's content
      // read and Member's `stats.read` at scopes the backfill would never choose,
      // so a predicate that drops `r.name = 'teacher'` normalises them and fails.
      const adminRole = await roleId('admin');
      const memberRole = await roleId('member');
      await service
        .from('org_role_permissions')
        .update({ scope: 'own' })
        .eq('org_role_id', adminRole)
        .eq('permission_key', 'flashcard.read');
      await service
        .from('org_role_permissions')
        .update({ scope: 'organization' })
        .eq('org_role_id', memberRole)
        .eq('permission_key', 'stats.read');

      await runDirect(TEACHER_READ_BACKFILL);

      expect((await roleScopes('teacher'))['flashcard.read']).toBe('group');
      expect((await roleScopes('admin'))['flashcard.read']).toBe('own');
      expect((await roleScopes('member'))['stats.read']).toBe('organization');

      const { data: customRow, error: readError } = await service
        .from('org_role_permissions')
        .select('scope')
        .eq('org_role_id', customRoleId)
        .eq('permission_key', 'flashcard.read')
        .single();
      expect(readError).toBeNull();
      expect(customRow.scope).toBe('own');

      await service
        .from('org_role_permissions')
        .delete()
        .eq('org_role_id', customRoleId)
        .eq('permission_key', 'flashcard.read');

      // Restore the excluded roles to their matrix scopes for the rest of the file.
      await service
        .from('org_role_permissions')
        .update({ scope: 'organization' })
        .eq('org_role_id', adminRole)
        .eq('permission_key', 'flashcard.read');
      await service
        .from('org_role_permissions')
        .update({ scope: 'own' })
        .eq('org_role_id', memberRole)
        .eq('permission_key', 'stats.read');
    },
  );
});
