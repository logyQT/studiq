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
import { createTypedServiceClient } from '#test/integration/test-utils';

/**
 * RLS parity for the org-control permission sweep (ADR-0015 §4.1, §7; R4).
 *
 * The settings, roster, seat and invitation routes gate on `org.*` permissions,
 * so the tables must too. Before this migration every policy asked
 * `is_org_manager` — a `member.manage` entitlement marker — which meant a custom
 * role holding the new key passed the API and was refused by RLS (FP-01 through
 * PostgREST). Both directions are pinned with real signed-in sessions, and the
 * legacy-marker role is the control that proves the predicate moved rather than
 * widened.
 */

const PASSWORD = 'OrgControlRls!';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const MIGRATION = 'supabase/migrations/20261120110000_org_control_permission_rls.sql';

const localDatabaseUrl = (() => {
  const raw = process.env.SUPABASE_DB_URL;
  if (!raw) return null;
  const { hostname } = new URL(raw);
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname) ? raw : null;
})();

/**
 * A run without the local database URL must fail instead of skipping: a silent
 * skip would keep asserting against whatever policies a previous run applied, so
 * a reverted predicate would survive.
 */
function requireLocalDatabaseUrl(): string {
  if (!localDatabaseUrl) {
    throw new Error(
      "org-control-permission-rls needs SUPABASE_DB_URL pointing at this checkout's local " +
        'Supabase to install the shipped policies. Run the suite through ' +
        '`bun run env:run -- bun run test:integration`: a bare `bun run test:integration` ' +
        'in a fresh worktree has no database URL, and skipping the install would let a ' +
        'reverted predicate pass.',
    );
  }
  return localDatabaseUrl;
}

/** Install the shipped migration the way a reset would (`alter policy` is idempotent). */
async function installShippedSql(): Promise<void> {
  const sql = postgres(requireLocalDatabaseUrl(), { max: 1, onnotice: () => {} });
  try {
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

describe('org-control permission RLS', () => {
  const service = createTypedServiceClient();

  let orgId: string;
  let foreignOrgId: string;
  let memberRoleId: string;
  let teacherRoleId: string;
  let adminRoleId: string;
  let holderRoleId: string;
  let legacyRoleId: string;
  let invitationManagerRoleId: string;

  let holderId: string;
  let legacyId: string;
  let invitationManagerId: string;
  let memberId: string;
  let teacherId: string;
  let outsiderId: string;
  let disposableId: string;

  let holder: SupabaseClient<Database>;
  let legacy: SupabaseClient<Database>;
  let invitationManager: SupabaseClient<Database>;
  let member: SupabaseClient<Database>;
  let teacher: SupabaseClient<Database>;
  let outsider: SupabaseClient<Database>;

  async function createUser(email: string, label: string, role: string): Promise<string> {
    const { data, error } = await service.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { name: label, account_type: role },
    });
    if (error) throw new Error(`createUser ${label} failed: ${error.message}`);
    return data.user.id;
  }

  async function customRole(organizationId: string, name: string, keys: string[]): Promise<string> {
    const { data: role, error } = await service
      .from('org_roles')
      .insert({ organization_id: organizationId, name, display_name: name, is_system: false })
      .select('id')
      .single();
    if (error) throw new Error(`role ${name} create failed: ${error.message}`);

    if (keys.length > 0) {
      const { error: permissionError } = await service
        .from('org_role_permissions')
        .insert(
          keys.map((key) => ({ org_role_id: role.id, permission_key: key, scope: 'organization' })),
        );
      if (permissionError) throw new Error(`permission ${name} failed: ${permissionError.message}`);
    }

    return role.id;
  }

  async function insertPool(organizationId: string, planKey: string, total: number) {
    const { data, error } = await service
      .from('org_seat_pools')
      .insert({ organization_id: organizationId, plan_key: planKey, total })
      .select('id')
      .single();
    if (error) throw new Error(`pool insert failed: ${error.message}`);
    return data.id;
  }

  /**
   * One pool per (org, plan_key): the table is unique on that pair. The seat
   * cases share it rather than each inserting their own.
   */
  async function ensurePool(organizationId: string, planKey: string, total: number) {
    const { data: existing } = await service
      .from('org_seat_pools')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('plan_key', planKey)
      .maybeSingle();
    return existing?.id ?? insertPool(organizationId, planKey, total);
  }

  async function insertAssignment(organizationId: string, poolId: string, userId: string) {
    const { data, error } = await service
      .from('org_seat_assignments')
      .insert({ organization_id: organizationId, pool_id: poolId, user_id: userId })
      .select('id')
      .single();
    if (error) throw new Error(`assignment insert failed: ${error.message}`);
    return data.id;
  }

  async function insertInvitation(data: {
    organizationId: string;
    inviterId: string;
    targetOrgRoleId: string;
    email: string;
  }) {
    const { data: row, error } = await service
      .from('invitations')
      .insert({
        email: data.email,
        target_org_role_id: data.targetOrgRoleId,
        organization_id: data.organizationId,
        inviter_id: data.inviterId,
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .select('id')
      .single();
    if (error) throw new Error(`invitation insert failed: ${error.message}`);
    return row.id;
  }

  beforeAll(async () => {
    await installShippedSql();

    const org = await seedOrganization(`org-control-rls-${tag}`);
    orgId = org.org.id;
    memberRoleId = org.memberRoleId;
    teacherRoleId = org.teacherRoleId;
    adminRoleId = org.adminRoleId;

    const foreignOrg = await seedOrganization(`org-control-rls-foreign-${tag}`);
    foreignOrgId = foreignOrg.org.id;

    holderRoleId = await customRole(orgId, `org-control-holder-${tag}`, [
      'org.settings.manage',
      'org.member.manage',
      'org.seat.manage',
      'org.invitation.manage',
    ]);
    // The control: the legacy `member.manage` marker the old policies read,
    // with no permission key. It must lose every predicate this slice moved.
    legacyRoleId = await customRole(orgId, `org-control-legacy-${tag}`, []);

    // Invitation writes keep `rls_caller_can_assign_org_role` until 2b-4, and
    // that helper still resolves the manager half from the legacy marker. The
    // positive invitation caller therefore carries the permission AND the
    // marker; the legacy control below carries only the marker and must still
    // be refused, which is what proves the permission branch moved.
    invitationManagerRoleId = await customRole(orgId, `org-control-inviter-${tag}`, [
      'org.invitation.manage',
    ]);

    for (const roleId of [legacyRoleId, invitationManagerRoleId]) {
      const { error: featureError } = await service.from('org_role_features').insert({
        org_role_id: roleId,
        feature_key: 'member.manage',
        is_enabled: true,
      });
      if (featureError) throw new Error(`feature grant failed: ${featureError.message}`);
    }

    holderId = await createUser(`org-control-holder-${tag}@dev.local`, 'holder', 'manager');
    legacyId = await createUser(`org-control-legacy-${tag}@dev.local`, 'legacy', 'manager');
    invitationManagerId = await createUser(
      `org-control-inviter-${tag}@dev.local`,
      'invitation manager',
      'manager',
    );
    memberId = await createUser(`org-control-member-${tag}@dev.local`, 'member', 'student');
    teacherId = await createUser(`org-control-teacher-${tag}@dev.local`, 'teacher', 'educator');
    outsiderId = await createUser(`org-control-outsider-${tag}@dev.local`, 'outsider', 'manager');
    disposableId = await createUser(
      `org-control-disposable-${tag}@dev.local`,
      'disposable',
      'student',
    );

    await seedOrgMembership({ organizationId: orgId, userId: holderId, orgRoleId: holderRoleId });
    await seedOrgMembership({ organizationId: orgId, userId: legacyId, orgRoleId: legacyRoleId });
    await seedOrgMembership({
      organizationId: orgId,
      userId: invitationManagerId,
      orgRoleId: invitationManagerRoleId,
    });
    await seedOrgMembership({ organizationId: orgId, userId: memberId, orgRoleId: memberRoleId });
    await seedOrgMembership({ organizationId: orgId, userId: teacherId, orgRoleId: teacherRoleId });
    await seedOrgMembership({
      organizationId: orgId,
      userId: disposableId,
      orgRoleId: memberRoleId,
    });
    await seedOrgMembership({
      organizationId: foreignOrgId,
      userId: outsiderId,
      orgRoleId: foreignOrg.memberRoleId,
    });

    holder = await signIn(`org-control-holder-${tag}@dev.local`);
    legacy = await signIn(`org-control-legacy-${tag}@dev.local`);
    invitationManager = await signIn(`org-control-inviter-${tag}@dev.local`);
    member = await signIn(`org-control-member-${tag}@dev.local`);
    teacher = await signIn(`org-control-teacher-${tag}@dev.local`);
    outsider = await signIn(`org-control-outsider-${tag}@dev.local`);
  });

  afterAll(async () => {
    await cleanupOrganizationDeep(orgId).catch(() => {});
    await cleanupOrganizationDeep(foreignOrgId).catch(() => {});
    for (const id of [
      holderId,
      legacyId,
      invitationManagerId,
      memberId,
      teacherId,
      outsiderId,
      disposableId,
    ]) {
      if (id) await service.auth.admin.deleteUser(id).catch(() => {});
    }
  });

  it('does not let the outsider session see or write this org', async () => {
    // The outsider's own membership is in another org; the tenant floor refuses
    // a row of this one before the capability is even consulted.
    const read = await outsider.from('organizations').select('id').eq('id', orgId);
    const write = await outsider
      .from('organizations')
      .update({ name: `outsider-${tag}` })
      .eq('id', orgId)
      .select('id');

    expect(read.error).toBeNull();
    expect(read.data).toEqual([]);
    expect(write.data).toEqual([]);
  });

  describe('organizations UPDATE — org.settings.manage', () => {
    it('lets the holder rename the org', async () => {
      const { error } = await holder
        .from('organizations')
        .update({ name: `holder-renamed-${tag}` })
        .eq('id', orgId);
      expect(error).toBeNull();

      const { data } = await service.from('organizations').select('name').eq('id', orgId).single();
      expect(data?.name).toBe(`holder-renamed-${tag}`);
    });

    it('refuses the Member role and the legacy manager marker', async () => {
      const before = (await service.from('organizations').select('name').eq('id', orgId).single())
        .data?.name;

      const memberUpdate = await member
        .from('organizations')
        .update({ name: `member-renamed-${tag}` })
        .eq('id', orgId)
        .select('id');
      const legacyUpdate = await legacy
        .from('organizations')
        .update({ name: `legacy-renamed-${tag}` })
        .eq('id', orgId)
        .select('id');

      expect(memberUpdate.error).toBeNull();
      expect(memberUpdate.data).toEqual([]);
      expect(legacyUpdate.data).toEqual([]);

      const after = (await service.from('organizations').select('name').eq('id', orgId).single())
        .data?.name;
      expect(after).toBe(before);
    });

    it('keeps the tenant scope: a permission only reaches the caller own org', async () => {
      const { data } = await holder
        .from('organizations')
        .update({ name: `cross-org-${tag}` })
        .eq('id', foreignOrgId)
        .select('id');

      expect(data).toEqual([]);
      const foreignName = (
        await service.from('organizations').select('name').eq('id', foreignOrgId).single()
      ).data?.name;
      expect(foreignName).not.toBe(`cross-org-${tag}`);
    });
  });

  describe('org_members UPDATE/DELETE — org.member.manage', () => {
    it('lets the holder change a member role', async () => {
      const { data, error } = await holder
        .from('org_members')
        .update({ org_role_id: teacherRoleId })
        .eq('organization_id', orgId)
        .eq('user_id', disposableId)
        .select('user_id');
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it('refuses the Member role and the legacy manager marker', async () => {
      await service
        .from('org_members')
        .update({ org_role_id: memberRoleId })
        .eq('organization_id', orgId)
        .eq('user_id', disposableId);

      const memberUpdate = await member
        .from('org_members')
        .update({ org_role_id: adminRoleId })
        .eq('organization_id', orgId)
        .eq('user_id', disposableId)
        .select('user_id');
      const legacyUpdate = await legacy
        .from('org_members')
        .update({ org_role_id: adminRoleId })
        .eq('organization_id', orgId)
        .eq('user_id', disposableId)
        .select('user_id');

      expect(memberUpdate.data).toEqual([]);
      expect(legacyUpdate.data).toEqual([]);

      const { data } = await service
        .from('org_members')
        .select('org_role_id')
        .eq('organization_id', orgId)
        .eq('user_id', disposableId)
        .single();
      expect(data?.org_role_id).toBe(memberRoleId);
    });

    it('never targets the caller own row, whoever holds the key', async () => {
      const { data } = await holder
        .from('org_members')
        .update({ org_role_id: adminRoleId })
        .eq('organization_id', orgId)
        .eq('user_id', holderId)
        .select('user_id');

      expect(data).toEqual([]);
    });

    // The self clause is on the DELETE policy's USING, so a manager's own row is
    // filtered out of the statement: zero rows, no error, and the membership
    // survives.
    it('never lets a manager delete their own membership row', async () => {
      const { data, error } = await holder
        .from('org_members')
        .delete()
        .eq('organization_id', orgId)
        .eq('user_id', holderId)
        .select('user_id');

      expect(error).toBeNull();
      expect(data).toEqual([]);

      const { data: kept } = await service
        .from('org_members')
        .select('user_id')
        .eq('organization_id', orgId)
        .eq('user_id', holderId);
      expect(kept).toHaveLength(1);
    });

    it('lets the holder remove another member and refuses the rest', async () => {
      const removal = await holder
        .from('org_members')
        .delete()
        .eq('organization_id', orgId)
        .eq('user_id', disposableId)
        .select('user_id');
      expect(removal.error).toBeNull();
      expect(removal.data).toHaveLength(1);

      const target = await createUser(`org-control-target-${tag}@dev.local`, 'target', 'student');
      await seedOrgMembership({ organizationId: orgId, userId: target, orgRoleId: memberRoleId });

      const memberDelete = await member
        .from('org_members')
        .delete()
        .eq('organization_id', orgId)
        .eq('user_id', target)
        .select('user_id');
      const legacyDelete = await legacy
        .from('org_members')
        .delete()
        .eq('organization_id', orgId)
        .eq('user_id', target)
        .select('user_id');

      expect(memberDelete.data).toEqual([]);
      expect(legacyDelete.data).toEqual([]);

      const { data } = await service
        .from('org_members')
        .select('user_id')
        .eq('organization_id', orgId)
        .eq('user_id', target);
      expect(data).toHaveLength(1);
      await service.auth.admin.deleteUser(target).catch(() => {});
    });
  });

  describe('org_seat_pools writes — org.seat.manage', () => {
    it('lets the holder insert and delete a pool', async () => {
      const { data, error } = await holder
        .from('org_seat_pools')
        .insert({ organization_id: orgId, plan_key: 'ace', total: 3 })
        .select('id')
        .single();
      expect(error).toBeNull();

      const { error: deleteError } = await holder
        .from('org_seat_pools')
        .delete()
        .eq('id', data!.id);
      expect(deleteError).toBeNull();
    });

    it('refuses INSERT for the Member role and the legacy manager marker (42501)', async () => {
      const memberInsert = await member
        .from('org_seat_pools')
        .insert({ organization_id: orgId, plan_key: 'ace', total: 1 });
      const legacyInsert = await legacy
        .from('org_seat_pools')
        .insert({ organization_id: orgId, plan_key: 'ace', total: 1 });

      expect(memberInsert.error?.code).toBe('42501');
      expect(legacyInsert.error?.code).toBe('42501');
    });

    it('refuses DELETE without the key and keeps the row', async () => {
      const poolId = await insertPool(orgId, 'ace', 1);

      const memberDelete = await member
        .from('org_seat_pools')
        .delete()
        .eq('id', poolId)
        .select('id');
      const legacyDelete = await legacy
        .from('org_seat_pools')
        .delete()
        .eq('id', poolId)
        .select('id');

      expect(memberDelete.data).toEqual([]);
      expect(legacyDelete.data).toEqual([]);

      const { data } = await service.from('org_seat_pools').select('id').eq('id', poolId);
      expect(data).toHaveLength(1);
    });

    // The UPDATE policy carries the capability twice (USING and WITH CHECK). A
    // `with check` left on the legacy predicate keeps the holder's row visible
    // and then refuses the write with 42501, so this case pins the write itself
    // and the untouched row for everybody else.
    it('lets the holder UPDATE a pool and refuses everyone else without touching it', async () => {
      const poolId = await insertPool(orgId, `ace-update-${tag}`, 1);

      const holderUpdate = await holder
        .from('org_seat_pools')
        .update({ total: 4 })
        .eq('id', poolId)
        .select('id, total');
      expect(holderUpdate.error).toBeNull();
      expect(holderUpdate.data).toHaveLength(1);

      const memberUpdate = await member
        .from('org_seat_pools')
        .update({ total: 99 })
        .eq('id', poolId)
        .select('id');
      const legacyUpdate = await legacy
        .from('org_seat_pools')
        .update({ total: 99 })
        .eq('id', poolId)
        .select('id');

      // A refused USING filters the row, so the answer is no rows, not 42501.
      expect(memberUpdate.data).toEqual([]);
      expect(legacyUpdate.data).toEqual([]);

      const { data } = await service
        .from('org_seat_pools')
        .select('total')
        .eq('id', poolId)
        .single();
      expect(data?.total).toBe(4);
    });
  });

  describe('org_seat_assignments writes — org.seat.manage', () => {
    it('lets the holder assign and unassign a seat', async () => {
      const poolId = await ensurePool(orgId, 'ace', 2);

      const { data, error } = await holder
        .from('org_seat_assignments')
        .insert({ organization_id: orgId, pool_id: poolId, user_id: memberId })
        .select('id')
        .single();
      expect(error).toBeNull();

      const { error: deleteError } = await holder
        .from('org_seat_assignments')
        .delete()
        .eq('id', data!.id);
      expect(deleteError).toBeNull();
    });

    it('refuses INSERT for the Member role and the legacy manager marker (42501)', async () => {
      const poolId = await ensurePool(orgId, 'ace', 2);

      const memberInsert = await member
        .from('org_seat_assignments')
        .insert({ organization_id: orgId, pool_id: poolId, user_id: memberId });
      const legacyInsert = await legacy
        .from('org_seat_assignments')
        .insert({ organization_id: orgId, pool_id: poolId, user_id: legacyId });

      expect(memberInsert.error?.code).toBe('42501');
      expect(legacyInsert.error?.code).toBe('42501');
    });

    it('refuses DELETE without the key and keeps the row', async () => {
      const poolId = await ensurePool(orgId, 'ace', 2);
      const assignmentId = await insertAssignment(orgId, poolId, memberId);

      const memberDelete = await member
        .from('org_seat_assignments')
        .delete()
        .eq('id', assignmentId)
        .select('id');
      const legacyDelete = await legacy
        .from('org_seat_assignments')
        .delete()
        .eq('id', assignmentId)
        .select('id');

      expect(memberDelete.data).toEqual([]);
      expect(legacyDelete.data).toEqual([]);

      const { data } = await service
        .from('org_seat_assignments')
        .select('id')
        .eq('id', assignmentId);
      expect(data).toHaveLength(1);
    });

    it('lets the holder UPDATE an assignment and refuses everyone else without touching it', async () => {
      const poolId = await ensurePool(orgId, `assign-update-${tag}`, 2);
      const otherPoolId = await ensurePool(orgId, `assign-update-target-${tag}`, 2);
      const assignmentId = await insertAssignment(orgId, poolId, legacyId);

      const holderUpdate = await holder
        .from('org_seat_assignments')
        .update({ pool_id: otherPoolId })
        .eq('id', assignmentId)
        .select('id, pool_id');
      expect(holderUpdate.error).toBeNull();
      expect(holderUpdate.data).toHaveLength(1);

      // The member's own SELECT branch does not reach the write: the UPDATE
      // policy has no self clause, so a refused USING answers zero rows.
      const memberUpdate = await member
        .from('org_seat_assignments')
        .update({ pool_id: otherPoolId })
        .eq('user_id', memberId)
        .select('id');
      const legacyUpdate = await legacy
        .from('org_seat_assignments')
        .update({ pool_id: poolId })
        .eq('id', assignmentId)
        .select('id');

      expect(memberUpdate.data).toEqual([]);
      expect(legacyUpdate.data).toEqual([]);

      const { data } = await service
        .from('org_seat_assignments')
        .select('pool_id')
        .eq('id', assignmentId)
        .single();
      expect(data?.pool_id).toBe(otherPoolId);
    });
  });

  describe('org_seat_assignments read — the manager branch moved with the list route', () => {
    it('lets the holder read an assignment it does not own', async () => {
      const poolId = await ensurePool(orgId, 'spark', 2);
      const assignmentId = await insertAssignment(orgId, poolId, teacherId);

      const { data, error } = await holder
        .from('org_seat_assignments')
        .select('id, user_id')
        .eq('id', assignmentId);

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]?.user_id).toBe(teacherId);
    });

    it('refuses the legacy manager marker and a plain member (only their own row)', async () => {
      const poolId = await ensurePool(orgId, 'spark', 2);
      const assignmentId = await insertAssignment(orgId, poolId, invitationManagerId);

      const legacyRead = await legacy
        .from('org_seat_assignments')
        .select('id')
        .eq('id', assignmentId);
      // The member reads their OWN assignment by design; the row is another user's.
      const memberRead = await member
        .from('org_seat_assignments')
        .select('id')
        .eq('id', assignmentId);

      expect(legacyRead.data).toEqual([]);
      expect(memberRead.data).toEqual([]);
    });
  });

  describe('invitations writes — org.invitation.manage', () => {
    it('lets the holder retarget and revoke an invitation', async () => {
      // Minted by someone else, so only the permission branch can authorize
      // the retarget — the inviter branch is pinned separately below.
      const invitationId = await insertInvitation({
        organizationId: orgId,
        inviterId: holderId,
        targetOrgRoleId: memberRoleId,
        email: `holder-${tag}@example.com`,
      });

      const { data, error } = await invitationManager
        .from('invitations')
        .update({ target_org_role_id: teacherRoleId })
        .eq('id', invitationId)
        .select('id');
      expect(error).toBeNull();
      expect(data).toHaveLength(1);

      // The revoking session is not the inviter, and the DELETE predicate has no
      // `rls_caller_can_assign_org_role` conjunct: the permission alone is
      // enough. (The API's revoke additionally pre-reads the row through the
      // unmoved SELECT policy, so there the inviter branch is what shows it.)
      const { error: deleteError } = await invitationManager
        .from('invitations')
        .delete()
        .eq('id', invitationId);
      expect(deleteError).toBeNull();
    });

    it('refuses retarget/revoke for the Member role and the legacy manager marker', async () => {
      const invitationId = await insertInvitation({
        organizationId: orgId,
        inviterId: holderId,
        targetOrgRoleId: memberRoleId,
        email: `member-refused-${tag}@example.com`,
      });

      const memberUpdate = await member
        .from('invitations')
        .update({ target_org_role_id: teacherRoleId })
        .eq('id', invitationId)
        .select('id');
      const legacyUpdate = await legacy
        .from('invitations')
        .update({ target_org_role_id: teacherRoleId })
        .eq('id', invitationId)
        .select('id');
      const memberDelete = await member
        .from('invitations')
        .delete()
        .eq('id', invitationId)
        .select('id');
      const legacyDelete = await legacy
        .from('invitations')
        .delete()
        .eq('id', invitationId)
        .select('id');

      expect(memberUpdate.data).toEqual([]);
      expect(legacyUpdate.data).toEqual([]);
      expect(memberDelete.data).toEqual([]);
      expect(legacyDelete.data).toEqual([]);

      const { data } = await service.from('invitations').select('id').eq('id', invitationId);
      expect(data).toHaveLength(1);
    });

    it('keeps the inviter branch and the grant-authority conjunct', async () => {
      // A Teacher may invite into the system member role (the classroom flow
      // 2b-4 rewrites). The inviter branch is what lets them edit their own
      // row, and `rls_caller_can_assign_org_role` still bounds the target.
      const invitationId = await insertInvitation({
        organizationId: orgId,
        inviterId: teacherId,
        targetOrgRoleId: memberRoleId,
        email: `teacher-invite-${tag}@example.com`,
      });

      const ownEdit = await teacher
        .from('invitations')
        .update({ target_org_role_id: memberRoleId })
        .eq('id', invitationId)
        .select('id');
      expect(ownEdit.error).toBeNull();
      expect(ownEdit.data).toHaveLength(1);

      const escalation = await teacher
        .from('invitations')
        .update({ target_org_role_id: adminRoleId })
        .eq('id', invitationId)
        .select('id');
      expect(escalation.error?.code, 'a Teacher cannot grant the Admin role').toBe('42501');
    });

    it('still lets a Teacher INSERT the classroom invitation (2b-4 owns this policy)', async () => {
      // The INSERT policy keeps `rls_caller_can_assign_org_role`: adding the
      // org.invitation.manage conjunct here would refuse the classroom invite
      // its POST route deliberately keeps.
      const { error } = await teacher.from('invitations').insert({
        email: `teacher-create-${tag}@example.com`,
        target_org_role_id: memberRoleId,
        organization_id: orgId,
        inviter_id: teacherId,
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      });
      expect(error).toBeNull();
    });

    it('keeps the tenant scope on a foreign invitation', async () => {
      const foreignInvitationId = await insertInvitation({
        organizationId: foreignOrgId,
        inviterId: outsiderId,
        targetOrgRoleId: (
          await service
            .from('org_roles')
            .select('id')
            .eq('organization_id', foreignOrgId)
            .eq('name', 'member')
            .single()
        ).data!.id,
        email: `foreign-${tag}@example.com`,
      });

      const { data } = await invitationManager
        .from('invitations')
        .update({ target_org_role_id: teacherRoleId })
        .eq('id', foreignInvitationId)
        .select('id');

      expect(data).toEqual([]);
    });
  });
});
