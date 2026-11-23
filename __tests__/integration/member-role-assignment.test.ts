import { readFileSync } from 'node:fs';
import * as supabaseModule from '@studiq/server/lib/supabase/server';
import type { Database } from '@studiq/server/types/database';
import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { json } from '#test/helpers/json';
import { createTestUser, type TestUserFixture } from '#test/helpers/test-user';
import {
  cleanupOrganizationDeep,
  seedOrgMembership,
  seedOrganization,
  useRealSupabase,
} from '#test/integration/helpers';
import { createNextRequest, createTypedServiceClient } from '#test/integration/test-utils';
import { PUT as putMembers } from '@/app/(backend)/api/v1/organization/members/route';

/**
 * ADR-0015 §4.4 "grant only what you hold" on the MEMBER-ASSIGNMENT path
 * (phase 5c, 2b-9 register row 13; D16, D21; R4, R26, R28, R40).
 *
 * `PUT /api/v1/organization/members` (`organization-member.service.ts#changeRole`)
 * now calls `rls_caller_may_assign_org_role(p_role_id)` on the user client after
 * the cross-org role lookup, and the `org_members` UPDATE policy's WITH CHECK
 * carries the same wrapper — the API and the table share
 * `actor_may_assign_org_role` with the invite path (one definition, 5b's
 * `covers_permission` underneath).
 *
 * The matrix, through the real route + `withAuth` with REAL signed-in sessions
 * (the wrapper resolves `auth.uid()`, so the API half must run with a JWT, not
 * the service-role mock) AND through PostgREST with real sessions:
 *
 * - a custom `org.member.manage`-only role may assign a role whose keys they
 *   all cover (API 200, PostgREST update OK, wrapper true);
 * - the same holder is REFUSED the system Admin role (its `org.admin` row is
 *   `assignable = false` and they do not hold it) — API 403, PostgREST 42501,
 *   wrapper false, membership row unchanged;
 * - the same holder is REFUSED a role holding a key they do not cover
 *   (`org.billing.manage` at organization scope);
 * - an `org.admin` holder may assign ANY role, including Admin (API 200,
 *   PostgREST OK, wrapper true).
 *
 * The shipped migrations are replayed from their files so a reverted predicate
 * cannot survive (same pattern as can-assign-org-role.test.ts; 5c's file owns
 * `can_assign_org_role` now, so it replays after 5b's — R27).
 */

const PASSWORD = 'MemberAssign5c!';
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
      'member-role-assignment needs SUPABASE_DB_URL pointing at this checkout’s local Supabase. ' +
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
      'supabase/migrations/20261123100000_member_assignment_grant_only_what_you_hold.sql',
    ]) {
      await sql.unsafe(readFileSync(file, 'utf8'));
    }
  } finally {
    await sql.end();
  }
}

/** A plain PostgREST session (anon key + the user's JWT). */
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

/** A cookie-jar session for the app's `createClient()` (route-handler half). */
interface AppSession {
  user: TestUserFixture;
  build: () => SupabaseClient<Database>;
}

async function signInApp(user: TestUserFixture, password: string): Promise<AppSession> {
  const jar = new Map<string, string>();
  const build = () =>
    createServerClient<Database>(url, anonKey, {
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: (cookiesToSet) => {
          for (const { name, value } of cookiesToSet) jar.set(name, value);
        },
      },
    });
  const { error } = await build().auth.signInWithPassword({ email: user.email, password });
  if (error) throw new Error(`[setup] signIn failed for ${user.email}: ${error.message}`);
  return { user, build };
}

/** Makes the app's `createClient()` resolve to the acting user's real session. */
function actAs(session: AppSession) {
  vi.mocked(supabaseModule.createClient).mockImplementation(() => Promise.resolve(session.build()));
}

function putRequest(session: AppSession, body: unknown, orgId: string) {
  actAs(session);
  return createNextRequest(
    'http://localhost/api/v1/organization/members',
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    { active_org_id: orgId },
  );
}

interface ApiEnvelope {
  success: boolean;
  error?: string;
}

describe('member role assignment — §4.4 grant-only-what-you-hold (phase 5c, row 13)', () => {
  const service = createTypedServiceClient();

  let capUser!: TestUserFixture; // org.member.manage only — NOT org.admin
  let adminUser!: TestUserFixture; // system Admin role (holds org.admin@organization)
  let targetCovered!: TestUserFixture;
  let targetAdmin!: TestUserFixture;
  let targetUncovered!: TestUserFixture;

  let orgId!: string;
  let adminRoleId!: string;
  let memberRoleId!: string;
  /** The member-manager's own role: `org.member.manage` only — not org.admin. */
  let memberManagerRoleId!: string;
  /** A role whose keys the member-manager covers: org.member.manage@organization. */
  let coveredRoleId!: string;
  /** A role holding a key the member-manager does NOT cover. */
  let uncoveredRoleId!: string;

  let capApi!: AppSession;
  let adminApi!: AppSession;
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

  async function memberRoleOf(userId: string): Promise<string | null> {
    const { data } = await service
      .from('org_members')
      .select('org_role_id')
      .eq('organization_id', orgId)
      .eq('user_id', userId)
      .single();
    return data?.org_role_id ?? null;
  }

  beforeAll(async () => {
    await installShippedSql();

    const org = await seedOrganization(`member-assign-5c-${tag}`);
    orgId = org.org.id;
    adminRoleId = org.adminRoleId;
    memberRoleId = org.memberRoleId;

    memberManagerRoleId = await customRole(`member-manager-${tag}`, [
      ['org.member.manage', 'organization'],
    ]);
    coveredRoleId = await customRole(`covered-${tag}`, [['org.member.manage', 'organization']]);
    uncoveredRoleId = await customRole(`uncovered-${tag}`, [
      ['org.billing.manage', 'organization'],
    ]);

    capUser = await createTestUser({ role: 'manager', password: PASSWORD });
    await seedOrgMembership({
      organizationId: orgId,
      userId: capUser.id,
      orgRoleId: memberManagerRoleId,
    });
    adminUser = await createTestUser({ role: 'manager', password: PASSWORD });
    await seedOrgMembership({
      organizationId: orgId,
      userId: adminUser.id,
      orgRoleId: adminRoleId,
    });
    targetCovered = await createTestUser({ role: 'student', password: PASSWORD });
    await seedOrgMembership({
      organizationId: orgId,
      userId: targetCovered.id,
      orgRoleId: memberRoleId,
    });
    targetAdmin = await createTestUser({ role: 'student', password: PASSWORD });
    await seedOrgMembership({
      organizationId: orgId,
      userId: targetAdmin.id,
      orgRoleId: memberRoleId,
    });
    targetUncovered = await createTestUser({ role: 'student', password: PASSWORD });
    await seedOrgMembership({
      organizationId: orgId,
      userId: targetUncovered.id,
      orgRoleId: memberRoleId,
    });

    capApi = await signInApp(capUser, PASSWORD);
    adminApi = await signInApp(adminUser, PASSWORD);
    capSession = await signIn(capUser.email, PASSWORD);
    adminSession = await signIn(adminUser.email, PASSWORD);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useRealSupabase();
  });

  afterAll(async () => {
    await cleanupOrganizationDeep(orgId).catch(() => {});
  });

  describe('API — the route asks rls_caller_may_assign_org_role after the role lookup', () => {
    it('lets the member-manager assign a role whose keys they cover', async () => {
      const res = await putMembers(
        putRequest(capApi, { targetUserId: targetCovered.id, newOrgRoleId: coveredRoleId }, orgId),
      );
      const body = await json<ApiEnvelope>(res);

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(await memberRoleOf(targetCovered.id)).toBe(coveredRoleId);
    });

    it('refuses the member-manager an assignment of the system Admin role', async () => {
      const res = await putMembers(
        putRequest(capApi, { targetUserId: targetAdmin.id, newOrgRoleId: adminRoleId }, orgId),
      );
      const body = await json<ApiEnvelope>(res);

      expect(res.status).toBe(403);
      expect(body.error).toBe('FORBIDDEN');
      expect(await memberRoleOf(targetAdmin.id)).toBe(memberRoleId);
    });

    it('refuses the member-manager a role holding a key they do not cover', async () => {
      const res = await putMembers(
        putRequest(
          capApi,
          { targetUserId: targetUncovered.id, newOrgRoleId: uncoveredRoleId },
          orgId,
        ),
      );
      const body = await json<ApiEnvelope>(res);

      expect(res.status).toBe(403);
      expect(body.error).toBe('FORBIDDEN');
      expect(await memberRoleOf(targetUncovered.id)).toBe(memberRoleId);
    });

    it('lets an org.admin holder assign the system Admin role', async () => {
      const res = await putMembers(
        putRequest(adminApi, { targetUserId: targetAdmin.id, newOrgRoleId: adminRoleId }, orgId),
      );

      expect(res.status).toBe(200);
      expect(await memberRoleOf(targetAdmin.id)).toBe(adminRoleId);
    });
  });

  describe('PostgREST — the same conjunct in the UPDATE policy WITH CHECK', () => {
    it('refuses the member-manager an org_members update to Admin (42501), allows the covered role', async () => {
      const before = await memberRoleOf(targetAdmin.id);

      const refused = await capSession
        .from('org_members')
        .update({ org_role_id: adminRoleId })
        .eq('organization_id', orgId)
        .eq('user_id', targetAdmin.id)
        .select('user_id');
      expect(refused.error?.code).toBe('42501');
      // The refused write changed nothing.
      expect(await memberRoleOf(targetAdmin.id)).toBe(before);

      const allowed = await capSession
        .from('org_members')
        .update({ org_role_id: coveredRoleId })
        .eq('organization_id', orgId)
        .eq('user_id', targetUncovered.id)
        .select('user_id');
      expect(allowed.error).toBeNull();
      expect(await memberRoleOf(targetUncovered.id)).toBe(coveredRoleId);
    });

    it('lets the org.admin holder update org_members to Admin through PostgREST', async () => {
      const ok = await adminSession
        .from('org_members')
        .update({ org_role_id: adminRoleId })
        .eq('organization_id', orgId)
        .eq('user_id', targetCovered.id)
        .select('user_id');
      expect(ok.error).toBeNull();
      expect(await memberRoleOf(targetCovered.id)).toBe(adminRoleId);
    });

    it('pins the wrapper: rls_caller_may_assign_org_role answers per §4.4', async () => {
      const capRefused = await capSession.rpc('rls_caller_may_assign_org_role', {
        p_role_id: adminRoleId,
      });
      expect(capRefused.data).toBe(false);

      const capAllowed = await capSession.rpc('rls_caller_may_assign_org_role', {
        p_role_id: coveredRoleId,
      });
      expect(capAllowed.data).toBe(true);

      const capUncovered = await capSession.rpc('rls_caller_may_assign_org_role', {
        p_role_id: uncoveredRoleId,
      });
      expect(capUncovered.data).toBe(false);

      const adminAllowed = await adminSession.rpc('rls_caller_may_assign_org_role', {
        p_role_id: adminRoleId,
      });
      expect(adminAllowed.data).toBe(true);

      // The actor-parameterized helper stays service_role-only: a direct call
      // from an authenticated session is refused, the wrapper is the surface.
      const capId = (await capSession.auth.getUser()).data.user!.id;
      const direct = await capSession.rpc('actor_may_assign_org_role', {
        p_actor: capId,
        p_role_id: coveredRoleId,
      });
      expect(direct.error).toBeTruthy();
    });
  });
});
