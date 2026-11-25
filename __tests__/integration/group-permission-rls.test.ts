import { readFileSync } from 'node:fs';
import type { Database } from '@studiq/server/types/database';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cleanupOrganizationDeep,
  seedGroupMembership,
  seedOrganization,
  seedOrgMembership,
} from '#test/integration/helpers';
import { createTypedServiceClient } from '#test/integration/test-utils';

/**
 * RLS parity for the group permission gates (ADR-0015 §4.3, §6.3; R4).
 *
 * The group routes now ask `group.*` for one group, so the tables must too:
 * before this migration the six write policies on `groups`/`group_members`
 * asked an org-wide legacy feature marker. A teacher of one class could
 * therefore write every class in the org through PostgREST, and a role holding
 * the permission could write none.
 *
 * Every write below is a real signed-in session through PostgREST — the path a
 * browser takes — not the service role.
 */

const PASSWORD = 'GroupPermRls!';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const MIGRATION = 'supabase/migrations/20261119212000_group_permission_rls.sql';

const localDatabaseUrl = (() => {
  const raw = process.env.SUPABASE_DB_URL;
  if (!raw) return null;
  const { hostname } = new URL(raw);
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname) ? raw : null;
})();

/**
 * A run without the direct connection must fail instead of skipping: skipping
 * would assert against whatever policies a previous run applied, so a reverted
 * predicate would survive (the 2a-2 lesson).
 */
function requireLocalDatabaseUrl(): string {
  if (!localDatabaseUrl) {
    throw new Error(
      'group-permission-rls needs SUPABASE_DB_URL pointing at this checkout’s local ' +
        'Supabase to install the shipped policies. Run the suite through ' +
        '`bun run env:run -- bun run test:integration`.',
    );
  }
  return localDatabaseUrl;
}

/**
 * Install the shipped migration the way a reset would. The helper's grant is
 * revoked first, so the migration's `grant execute` is load-bearing: a reset
 * starts from a database where the function does not exist yet, and a deleted
 * grant line must go red here (R19).
 */
async function installShippedSql(): Promise<void> {
  const sql = postgres(requireLocalDatabaseUrl(), { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(
      'do $$ begin revoke all on function public.rls_caller_has_group_permission(uuid, text) from public, anon, authenticated, service_role; exception when undefined_function then null; end $$;',
    );
    await sql.unsafe(readFileSync(MIGRATION, 'utf8'));
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

interface Person {
  id: string;
  session: SupabaseClient<Database>;
}

/**
 * How many group rows a signed-in session's UPDATE returns. PostgREST answers
 * `[]` when the row is filtered by the `USING` clause instead of raising
 * `42501` (the rls-tenant-isolation shape), so the count is the direction that
 * distinguishes "written" from "not written".
 */
async function groupsUpdated(
  session: SupabaseClient<Database>,
  groupId: string,
  description = `edited-${tag}`,
): Promise<number> {
  const { data, error } = await session
    .from('groups')
    .update({ description })
    .eq('id', groupId)
    .select('id');
  expect(error, 'a filtered UPDATE reports no error, only no rows').toBeNull();
  return data?.length ?? 0;
}

describe('group permission RLS predicate', () => {
  const service = createTypedServiceClient();

  let orgId: string;
  let foreignOrgId: string;
  /** A custom role holding every group key at `group` scope (the Teacher row). */
  let groupScopedRoleId: string;
  /** A custom role holding every group key at `organization` scope (Admin-like). */
  let orgScopedRoleId: string;
  /** A custom role holding the keys only at `own` scope. */
  let ownScopedRoleId: string;

  /** Two groups in org A. */
  let groupTaughtId: string;
  let groupOtherId: string;
  /** A group in org B. */
  let foreignGroupId: string;

  let teacherOfA: Person;
  let memberOfA: Person;
  let adminOfA: Person;
  let ownScopeOfA: Person;
  let foreignOrgTeacher: Person;

  const createdUserIds: string[] = [];

  async function createUser(label: string, accountType: string): Promise<Person> {
    const email = `${label}-${tag}@dev.local`;
    const { data, error } = await service.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { name: label, account_type: accountType },
    });
    if (error) throw new Error(`createUser ${label} failed: ${error.message}`);
    createdUserIds.push(data.user.id);
    return { id: data.user.id, session: await signIn(email) };
  }

  /** A custom role in `organizationId` holding every group key at `scope`. */
  async function groupRole(
    organizationId: string,
    name: string,
    scope: 'own' | 'group' | 'organization',
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

    const { error: permissionError } = await service.from('org_role_permissions').insert(
      ['group.read', 'group.manage', 'group.member.manage', 'group.invite'].map((key) => ({
        org_role_id: role.id,
        permission_key: key,
        scope,
      })),
    );
    if (permissionError) {
      throw new Error(`permissions for ${name} failed: ${permissionError.message}`);
    }
    return role.id;
  }

  /** A custom role in `organizationId` holding exactly `keys` at `scope`. */
  async function roleWith(
    organizationId: string,
    name: string,
    scope: 'own' | 'group' | 'organization',
    keys: readonly string[],
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

    const { error: permissionError } = await service
      .from('org_role_permissions')
      .insert(keys.map((key) => ({ org_role_id: role.id, permission_key: key, scope })));
    if (permissionError) {
      throw new Error(`permissions for ${name} failed: ${permissionError.message}`);
    }
    return role.id;
  }

  async function createGroup(organizationId: string, name: string): Promise<string> {
    const { data, error } = await service
      .from('groups')
      .insert({ organization_id: organizationId, name: `${name}-${tag}` })
      .select('id')
      .single();
    if (error) throw new Error(`group ${name} create failed: ${error.message}`);
    return data.id;
  }

  beforeAll(async () => {
    await installShippedSql();

    const org = await seedOrganization(`group-perm-${tag}`);
    orgId = org.org.id;
    const foreignOrg = await seedOrganization(`group-perm-foreign-${tag}`);
    foreignOrgId = foreignOrg.org.id;

    groupScopedRoleId = await groupRole(orgId, `group-scope-${tag}`, 'group');
    orgScopedRoleId = await groupRole(orgId, `org-scope-${tag}`, 'organization');
    ownScopedRoleId = await groupRole(orgId, `own-scope-${tag}`, 'own');

    groupTaughtId = await createGroup(orgId, 'taught');
    groupOtherId = await createGroup(orgId, 'other');
    foreignGroupId = await createGroup(foreignOrgId, 'foreign');

    teacherOfA = await createUser('teacher-a', 'educator');
    memberOfA = await createUser('member-a', 'student');
    adminOfA = await createUser('admin-a', 'manager');
    ownScopeOfA = await createUser('own-a', 'educator');
    foreignOrgTeacher = await createUser('teacher-b', 'educator');

    await seedOrgMembership({
      organizationId: orgId,
      userId: teacherOfA.id,
      orgRoleId: groupScopedRoleId,
    });
    await seedOrgMembership({
      organizationId: orgId,
      userId: memberOfA.id,
      orgRoleId: groupScopedRoleId,
    });
    await seedOrgMembership({
      organizationId: orgId,
      userId: adminOfA.id,
      orgRoleId: orgScopedRoleId,
    });
    await seedOrgMembership({
      organizationId: orgId,
      userId: ownScopeOfA.id,
      orgRoleId: ownScopedRoleId,
    });
    await seedOrgMembership({
      organizationId: foreignOrgId,
      userId: foreignOrgTeacher.id,
      orgRoleId: foreignOrg.memberRoleId,
    });

    // The teacher teaches `groupTaughtId` only; the member belongs to the same
    // group and to no other, so a diff between them is the membership role.
    await seedGroupMembership({ groupId: groupTaughtId, userId: teacherOfA.id, role: 'teacher' });
    await seedGroupMembership({ groupId: groupTaughtId, userId: memberOfA.id, role: 'member' });
    await seedGroupMembership({
      groupId: foreignGroupId,
      userId: foreignOrgTeacher.id,
      role: 'teacher',
    });
  });

  afterAll(async () => {
    if (orgId) await cleanupOrganizationDeep(orgId).catch(() => {});
    if (foreignOrgId) await cleanupOrganizationDeep(foreignOrgId).catch(() => {});
    for (const id of createdUserIds) {
      await service.auth.admin.deleteUser(id).catch(() => {});
    }
  });

  it('lets an authenticated session execute the helper the policies call', async () => {
    const allowed = await teacherOfA.session.rpc('rls_caller_has_group_permission', {
      p_group_id: groupTaughtId,
      p_permission: 'group.manage',
    });
    expect(allowed.error, 'authenticated may execute the helper').toBeNull();
    expect(allowed.data, 'a teacher of the group satisfies it').toBe(true);

    const denied = await memberOfA.session.rpc('rls_caller_has_group_permission', {
      p_group_id: groupTaughtId,
      p_permission: 'group.manage',
    });
    expect(denied.error, 'the control may execute it too').toBeNull();
    expect(denied.data, 'a member membership alone does not').toBe(false);
  });

  it('lets a teacher of the group write that group', async () => {
    expect(await groupsUpdated(teacherOfA.session, groupTaughtId, 'taught-edit')).toBe(1);

    const { data: stored } = await service
      .from('groups')
      .select('description')
      .eq('id', groupTaughtId)
      .single();
    expect(stored?.description, 'the row really carries the teacher edit').toBe('taught-edit');
  });

  it('refuses the same teacher on another group of the same org', async () => {
    expect(
      await groupsUpdated(teacherOfA.session, groupOtherId),
      'group.manage at group scope reaches one group',
    ).toBe(0);

    const { data: stored } = await service
      .from('groups')
      .select('description')
      .eq('id', groupOtherId)
      .single();
    expect(stored?.description, 'the other group is untouched').toBeNull();
  });

  it('refuses a member of the group even though it holds the same role', async () => {
    expect(
      await groupsUpdated(memberOfA.session, groupTaughtId),
      'a member membership is read-only',
    ).toBe(0);
  });

  it('lets an organization-scope holder write any group in the org', async () => {
    expect(
      await groupsUpdated(adminOfA.session, groupOtherId, 'admin-edit'),
      'organization scope reaches every group',
    ).toBe(1);
  });

  it('refuses a caller whose role holds the keys only at own scope', async () => {
    expect(
      await groupsUpdated(ownScopeOfA.session, groupTaughtId),
      'own scope is not authority over a group the caller did not create',
    ).toBe(0);
  });

  it('refuses a teacher from another organization', async () => {
    // This pins the ROLE, not the org: the caller is a teacher of the class and
    // holds the keys, but the role the helper joins is their foreign org's, so
    // nothing they hold applies here.
    expect(
      await groupsUpdated(foreignOrgTeacher.session, groupTaughtId),
      'a foreign-org role holds no key in this org',
    ).toBe(0);
  });

  it('refuses a teacher membership with no org_members row at all', async () => {
    // Pins the PROMISE, not the conjunct: a caller holding a `teacher` row in
    // the class and no membership in the org writes nothing. What refuses it and
    // what a probe of the helper's org join would show cannot be told apart from
    // a user session — measured, not asserted: removing the
    // `om.user_id = auth.uid()` conjunct leaves this case and the scope cases
    // green, because the helper reads `org_members` as its owner while this
    // session can only see its own row. The ledger records the gap.
    const stranger = await createUser('stranger-a', 'educator');
    await seedGroupMembership({ groupId: groupTaughtId, userId: stranger.id, role: 'teacher' });

    expect(
      await groupsUpdated(stranger.session, groupTaughtId),
      'a teacher membership outside the org owns nothing in it',
    ).toBe(0);
  });

  it('refuses a content key asked of the helper for a group the caller teaches', async () => {
    const contentKey = await teacherOfA.session.rpc('rls_caller_has_group_permission', {
      p_group_id: groupTaughtId,
      p_permission: 'deck.update',
    });
    expect(contentKey.error, 'the helper still runs for a catalogue key').toBeNull();
    expect(contentKey.data, 'only a group.* catalogue key can be asked of a group helper').toBe(
      false,
    );

    const groupKey = await teacherOfA.session.rpc('rls_caller_has_group_permission', {
      p_group_id: groupTaughtId,
      p_permission: 'group.manage',
    });
    expect(groupKey.data, 'the same caller and group, a group key').toBe(true);
  });

  it('refuses a former member whose group membership row outlived the org membership', async () => {
    // `group_members` has no foreign key to `org_members`, and #249's cleanup
    // trigger only runs on a removal through that path, so the helper's
    // org-membership conjunct is the only thing standing between a stale
    // `teacher` row and a former member writing the group.
    const departed = await createUser('departed-a', 'educator');
    await seedOrgMembership({
      organizationId: orgId,
      userId: departed.id,
      orgRoleId: groupScopedRoleId,
    });
    await seedGroupMembership({ groupId: groupTaughtId, userId: departed.id, role: 'teacher' });

    const { error: removalError } = await service
      .from('org_members')
      .delete()
      .eq('organization_id', orgId)
      .eq('user_id', departed.id);
    if (removalError) throw new Error(`removal failed: ${removalError.message}`);

    // The trigger removes the removal's own group rows (#249) and cannot be
    // bypassed, so the fixture writes the stale membership back — the state an
    // out-of-band removal (admin tooling, a missing path) leaves behind.
    await seedGroupMembership({ groupId: groupTaughtId, userId: departed.id, role: 'teacher' });

    expect(
      await groupsUpdated(departed.session, groupTaughtId),
      'a group teacher without an org_members row is not a member',
    ).toBe(0);
  });

  it('gates the roster on group.member.manage for that group', async () => {
    const { error } = await teacherOfA.session.from('group_members').insert({
      group_id: groupTaughtId,
      user_id: ownScopeOfA.id,
      role: 'member',
    });
    expect(error, 'the teacher of the group may add to its roster').toBeNull();

    const { data: roster } = await service
      .from('group_members')
      .select('user_id')
      .eq('group_id', groupTaughtId)
      .eq('user_id', ownScopeOfA.id);
    expect(roster, 'the added member is on the roster').toHaveLength(1);

    const denied = await teacherOfA.session.from('group_members').insert({
      group_id: groupOtherId,
      user_id: memberOfA.id,
      role: 'member',
    });
    expect(denied.error?.code, 'the roster of another group is out of reach').toBe('42501');
  });

  it('refuses a roster write from a member of the group', async () => {
    // The control for the insert above: the member holds the same role as the
    // teacher, so `group_members.role` is the only difference.
    const { data, error } = await memberOfA.session
      .from('group_members')
      .update({ role: 'teacher' })
      .eq('group_id', groupTaughtId)
      .eq('user_id', memberOfA.id)
      .select('role');

    expect(error, 'a filtered UPDATE reports no error, only no rows').toBeNull();
    expect(data, 'a member cannot promote themselves through PostgREST').toEqual([]);

    const { data: stored } = await service
      .from('group_members')
      .select('role')
      .eq('group_id', groupTaughtId)
      .eq('user_id', memberOfA.id)
      .single();
    expect(stored?.role, 'the membership keeps its role').toBe('member');
  });

  it('lets an organization-scope holder create a group', async () => {
    const { data, error } = await adminOfA.session
      .from('groups')
      .insert({ organization_id: orgId, name: `admin-made-${tag}` })
      .select('id');
    expect(error, 'an org-scope holder creates groups').toBeNull();
    expect(data, 'the insert returns the new row').toHaveLength(1);
  });

  it('lets a group-scope Teacher create a class, owned by its creator', async () => {
    // The 2b-2 decision (§4.3 scopes, §10 classes): a Teacher starts their own
    // class. The INSERT policy therefore accepts any scope the role holds
    // `group.manage` at, not `organization` alone.
    const { data, error } = await teacherOfA.session
      .from('groups')
      .insert({ organization_id: orgId, name: `teacher-made-${tag}`, created_by: teacherOfA.id })
      .select('id, created_by');

    expect(error, 'a group-scope group.manage creates groups').toBeNull();
    expect(data, 'the insert returns the new row').toHaveLength(1);
    expect(data?.[0]?.created_by, 'the creator is the class’s owner').toBe(teacherOfA.id);

    const { count } = await service
      .from('groups')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('name', `teacher-made-${tag}`);
    expect(count, 'the row really exists').toBe(1);
  });

  it('lets an own-scope group.manage create a class too', async () => {
    const { error } = await ownScopeOfA.session
      .from('groups')
      .insert({ organization_id: orgId, name: `own-made-${tag}` })
      .select('id');

    expect(error, 'own is a create scope as much as group is').toBeNull();
  });

  it('refuses a group creation by a role with no group.manage at any scope', async () => {
    // The roster-only shape: `group.member.manage` (and `group.read`) without
    // `group.manage`. A new class has no roster to manage, and the key the policy
    // asks for is not held, so PostgREST raises rather than filtering.
    const rosterRoleId = await roleWith(orgId, `roster-only-${tag}`, 'group', [
      'group.read',
      'group.member.manage',
    ]);
    const rosterOnly = await createUser('roster-only-a', 'educator');
    await seedOrgMembership({
      organizationId: orgId,
      userId: rosterOnly.id,
      orgRoleId: rosterRoleId,
    });
    const { data, error } = await rosterOnly.session
      .from('groups')
      .insert({ organization_id: orgId, name: `roster-made-${tag}` })
      .select('id');

    expect(error?.code, 'an INSERT policy refuses rather than filtering').toBe('42501');
    expect(data, 'nothing is created').toBeNull();

    const { data: stored } = await service
      .from('groups')
      .select('id')
      .eq('organization_id', orgId)
      .eq('name', `roster-made-${tag}`);
    expect(stored, 'the refused row does not exist').toEqual([]);
  });

  it('keeps every group of the org readable to its members', async () => {
    const { data, error } = await memberOfA.session
      .from('groups')
      .select('id')
      .eq('organization_id', orgId)
      .eq('id', groupOtherId);

    expect(error, 'the group list stays org-wide (the read policy is untouched)').toBeNull();
    expect(data, 'a member reads a class it does not belong to').toHaveLength(1);
  });
});
