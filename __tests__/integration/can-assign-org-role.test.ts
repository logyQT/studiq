import { readFileSync } from 'node:fs';
import type { Database } from '@studiq/server/types/database';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { json } from '#test/helpers/json';
import { createTestUser, type TestUserFixture } from '#test/helpers/test-user';
import {
  cleanupOrganizationDeep,
  mockUser,
  seedOrgMembership,
  seedOrganization,
  useRealSupabase,
} from '#test/integration/helpers';
import { createNextRequest, createTypedServiceClient } from '#test/integration/test-utils';
import {
  GET as inviteGet,
  POST as invitePost,
} from '@/app/(backend)/api/v1/organization/invites/route';

/**
 * ADR-0015 §4.4 "grant only what you hold" — the `can_assign_org_role`
 * conjunct (phase 5b, register row 9; D16, D21; R4, R26, R28).
 *
 * `can_assign_org_role(p_actor, p_role_id)` is now
 * `org.invitation.manage` AND (`org.admin`@organization OR every target-role
 * row is an assignable key the caller covers at that scope). The matrix, through
 * the real invite route + `withAuth` AND through PostgREST with real signed-in
 * sessions:
 *
 * - a capability holder who is NOT `org.admin` may invite into a role whose
 *   keys they all hold at covering scopes (API 201, PostgREST insert OK);
 * - the same holder is REFUSED for the system Admin role (its `org.admin` row
 *   is `assignable = false` and they do not hold `org.admin`) — API 403,
 *   PostgREST 42501, `rls_caller_can_assign_org_role` false;
 * - the same holder is REFUSED for a role holding a key they do not cover
 *   (`org.billing.manage` at organization scope);
 * - an `org.admin` holder may invite into ANY role, including Admin
 *   (API 201, PostgREST OK, wrapper true).
 *
 * The migration is replayed from its shipped file so a reverted predicate
 * cannot survive (same pattern as class-invite-permission.test.ts).
 */

const PASSWORD = 'CanAssign!5b';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const localDatabaseUrl = (() => {
  const raw = process.env.SUPABASE_DB_URL;
  if (!raw) return null;
  const { hostname } = new URL(raw);
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname) ? raw : null;
})();

function requireLocalDatabaseUrl(): string {
  if (!localDatabaseUrl) {
    throw new Error(
      'can-assign-org-role needs SUPABASE_DB_URL pointing at this checkout’s local Supabase. ' +
        'Run the suite through `bun run env:run -- bunx vitest run …`.',
    );
  }
  return localDatabaseUrl;
}

/** Replay the shipped 5b + 5c migrations so a reverted predicate cannot survive. */
async function installShippedSql(): Promise<void> {
  const sql = postgres(requireLocalDatabaseUrl(), { max: 1, onnotice: () => {} });
  try {
    for (const file of [
      'supabase/migrations/20261122180000_can_assign_grant_only_what_you_hold.sql',
      // 5c redefines can_assign_org_role onto actor_may_assign_org_role (R27:
      // the newest file owns the object, so it replays after 5b's).
      'supabase/migrations/20261123100000_member_assignment_grant_only_what_you_hold.sql',
    ]) {
      await sql.unsafe(readFileSync(file, 'utf8'));
    }
  } finally {
    await sql.end();
  }
}

function newClient(): SupabaseClient<Database> {
  return createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signIn(email: string, password: string): Promise<SupabaseClient<Database>> {
  const client = newClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signIn failed for ${email}: ${error.message}`);
  return client;
}

function postInvite(body: unknown, activeOrgId: string) {
  return createNextRequest(
    'http://localhost/api/v1/organization/invites',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    { active_org_id: activeOrgId },
  );
}

const expiry = () => new Date(Date.now() + 86_400_000).toISOString();

async function insertOrgInvite(
  session: SupabaseClient<Database>,
  userId: string,
  email: string,
  targetOrgRoleId: string,
  organizationId: string,
) {
  return session.from('invitations').insert({
    email,
    target_org_role_id: targetOrgRoleId,
    organization_id: organizationId,
    inviter_id: userId,
    expires_at: expiry(),
  });
}

interface ApiErrorBody {
  success: boolean;
  error?: string;
}

interface InviteCreatedBody {
  success: boolean;
  data: { success: boolean; invitationId: string; inviteLink: string; inviteCode: string };
}

describe('can_assign_org_role — §4.4 grant-only-what-you-hold (phase 5b)', () => {
  const service = createTypedServiceClient();

  let capUser!: TestUserFixture; // org.invitation.manage only — NOT org.admin
  let adminUser!: TestUserFixture; // system Admin role (holds org.admin@organization)

  let orgId!: string;
  let adminRoleId!: string;
  let memberRoleId!: string;
  /** The capability holder's own role: `org.invitation.manage` only — not org.admin. */
  let inviterRoleId!: string;
  /** A role whose keys the capability holder covers: invitation.manage@organization. */
  let coveredRoleId!: string;
  /** A role holding a key the capability holder does NOT cover. */
  let uncoveredRoleId!: string;

  let capSession!: SupabaseClient<Database>;
  let adminSession!: SupabaseClient<Database>;

  async function customRole(name: string, rows: Array<[string, string]>): Promise<string> {
    const { data: role, error } = await service
      .from('org_roles')
      .insert({ organization_id: orgId, name, display_name: name, is_system: false })
      .select('id')
      .single();
    if (error) throw new Error(`role ${name}: ${error.message}`);

    const { error: permissionError } = await service
      .from('org_role_permissions')
      .insert(
        rows.map(([permission_key, scope]) => ({ org_role_id: role.id, permission_key, scope })),
      );
    if (permissionError) throw new Error(`permissions ${name}: ${permissionError.message}`);
    return role.id;
  }

  async function createAuthUser(
    email: string,
    label: string,
    accountType: string,
  ): Promise<string> {
    const { data, error } = await service.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { name: label, account_type: accountType },
    });
    if (error) throw new Error(`createUser ${label} failed: ${error.message}`);
    return data.user.id;
  }

  beforeAll(async () => {
    await installShippedSql();

    const org = await seedOrganization(`can-assign-5b-${tag}`);
    orgId = org.org.id;
    adminRoleId = org.adminRoleId;
    memberRoleId = org.memberRoleId;

    inviterRoleId = await customRole(`inviter-${tag}`, [['org.invitation.manage', 'organization']]);
    coveredRoleId = await customRole(`covered-${tag}`, [['org.invitation.manage', 'organization']]);
    uncoveredRoleId = await customRole(`uncovered-${tag}`, [
      ['org.billing.manage', 'organization'],
    ]);

    capUser = await createTestUser({ role: 'manager', password: PASSWORD });
    await seedOrgMembership({
      organizationId: orgId,
      userId: capUser.id,
      orgRoleId: inviterRoleId,
    });

    adminUser = await createTestUser({ role: 'manager', password: PASSWORD });
    await seedOrgMembership({
      organizationId: orgId,
      userId: adminUser.id,
      orgRoleId: adminRoleId,
    });

    // Real signed-in sessions for the PostgREST half.
    const capAuthId = await createAuthUser(`can-assign-cap-${tag}@dev.local`, 'cap', 'manager');
    await seedOrgMembership({
      organizationId: orgId,
      userId: capAuthId,
      orgRoleId: inviterRoleId,
    });
    capSession = await signIn(`can-assign-cap-${tag}@dev.local`, PASSWORD);

    const adminAuthId = await createAuthUser(
      `can-assign-admin-${tag}@dev.local`,
      'admin',
      'manager',
    );
    await seedOrgMembership({
      organizationId: orgId,
      userId: adminAuthId,
      orgRoleId: adminRoleId,
    });
    adminSession = await signIn(`can-assign-admin-${tag}@dev.local`, PASSWORD);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useRealSupabase();
  });

  afterAll(async () => {
    await cleanupOrganizationDeep(orgId).catch(() => {});
  });

  describe('API — the invite route asks can_assign_org_role', () => {
    it('lets the capability holder invite into a role whose keys they cover', async () => {
      mockUser(capUser);
      const email = `covered-${tag}@example.com`;

      const res = await invitePost(postInvite({ email, targetOrgRoleId: coveredRoleId }, orgId));
      const created = await json<InviteCreatedBody>(res);

      expect(res.status).toBe(201);
      expect(created.data.invitationId).toBeTruthy();
    });

    it('refuses the capability holder an invite into the system Admin role', async () => {
      mockUser(capUser);
      const email = `admin-target-${tag}@example.com`;

      const res = await invitePost(postInvite({ email, targetOrgRoleId: adminRoleId }, orgId));
      const body = await json<ApiErrorBody>(res);

      expect(res.status).toBe(403);
      expect(body.error).toBe('FORBIDDEN');
      const { data } = await service.from('invitations').select('id').eq('email', email);
      expect(data).toEqual([]);
    });

    it('refuses the capability holder a role holding a key they do not cover', async () => {
      mockUser(capUser);
      const email = `uncovered-${tag}@example.com`;

      const res = await invitePost(postInvite({ email, targetOrgRoleId: uncoveredRoleId }, orgId));
      const body = await json<ApiErrorBody>(res);

      expect(res.status).toBe(403);
      expect(body.error).toBe('FORBIDDEN');
      const { data } = await service.from('invitations').select('id').eq('email', email);
      expect(data).toEqual([]);
    });

    it('lets an org.admin holder invite into any role, including Admin', async () => {
      mockUser(adminUser);
      const email = `admin-grants-${tag}@example.com`;

      const res = await invitePost(postInvite({ email, targetOrgRoleId: adminRoleId }, orgId));
      expect(res.status).toBe(201);

      const email2 = `admin-grants-2-${tag}@example.com`;
      const res2 = await invitePost(
        postInvite({ email: email2, targetOrgRoleId: uncoveredRoleId }, orgId),
      );
      expect(res2.status).toBe(201);
    });

    it('still lists the capability holder’s own invites (read half unchanged)', async () => {
      mockUser(capUser);

      const res = await inviteGet(
        createNextRequest(
          'http://localhost/api/v1/organization/invites?isAccepted=false',
          undefined,
          { active_org_id: orgId },
        ),
      );
      expect(res.status).toBe(200);
    });
  });

  describe('PostgREST — the same conjunct at the table', () => {
    it('refuses the capability holder an org invite targeting Admin (42501), allows the covered role', async () => {
      const capId = (await capSession.auth.getUser()).data.user!.id;

      const refused = await insertOrgInvite(
        capSession,
        capId,
        `pg-cap-admin-${tag}@example.com`,
        adminRoleId,
        orgId,
      );
      expect(refused.error?.code).toBe('42501');

      const allowed = await insertOrgInvite(
        capSession,
        capId,
        `pg-cap-covered-${tag}@example.com`,
        coveredRoleId,
        orgId,
      );
      expect(allowed.error).toBeNull();

      const refusedUncovered = await insertOrgInvite(
        capSession,
        capId,
        `pg-cap-uncovered-${tag}@example.com`,
        uncoveredRoleId,
        orgId,
      );
      expect(refusedUncovered.error?.code).toBe('42501');
    });

    it('lets the org.admin holder insert an org invite targeting Admin', async () => {
      const adminId = (await adminSession.auth.getUser()).data.user!.id;

      const ok = await insertOrgInvite(
        adminSession,
        adminId,
        `pg-admin-target-${tag}@example.com`,
        adminRoleId,
        orgId,
      );
      expect(ok.error).toBeNull();
    });

    it('pins the wrapper: rls_caller_can_assign_org_role answers per §4.4', async () => {
      const capRefused = await capSession.rpc('rls_caller_can_assign_org_role', {
        p_role_id: adminRoleId,
      });
      expect(capRefused.data).toBe(false);

      const capAllowed = await capSession.rpc('rls_caller_can_assign_org_role', {
        p_role_id: coveredRoleId,
      });
      expect(capAllowed.data).toBe(true);

      const adminAllowed = await adminSession.rpc('rls_caller_can_assign_org_role', {
        p_role_id: adminRoleId,
      });
      expect(adminAllowed.data).toBe(true);

      // The actor-parameterized helper stays service_role-only: a direct call
      // from an authenticated session is refused, the wrapper is the surface.
      const direct = await capSession.rpc('can_assign_org_role', {
        p_actor: (await capSession.auth.getUser()).data.user!.id,
        p_role_id: coveredRoleId,
      });
      expect(direct.error).toBeTruthy();
    });

    it('keeps the member-role caller refused everywhere (existing behaviour stays green)', async () => {
      const member = await createTestUser({ role: 'student', password: PASSWORD });
      await seedOrgMembership({
        organizationId: orgId,
        userId: member.id,
        orgRoleId: memberRoleId,
      });
      const memberAuthId = await createAuthUser(
        `can-assign-member-${tag}@dev.local`,
        'member',
        'student',
      );
      await seedOrgMembership({
        organizationId: orgId,
        userId: memberAuthId,
        orgRoleId: memberRoleId,
      });
      const memberSession = await signIn(`can-assign-member-${tag}@dev.local`, PASSWORD);
      const memberId = (await memberSession.auth.getUser()).data.user!.id;

      const insert = await insertOrgInvite(
        memberSession,
        memberId,
        `pg-member-${tag}@example.com`,
        memberRoleId,
        orgId,
      );
      expect(insert.error?.code).toBe('42501');

      mockUser(member);
      const res = await invitePost(
        postInvite(
          { email: `api-member-${tag}@example.com`, targetOrgRoleId: memberRoleId },
          orgId,
        ),
      );
      expect(res.status).toBe(403);
    });
  });
});
