import * as supabaseModule from '@studiq/server/lib/supabase/server';
import type { RequestContext } from '@studiq/authz';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@studiq/server/types/database';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSeedDb } from '#test/helpers/tenant-seed';
import { createTestUser, type TestUserFixture } from '#test/helpers/test-user';
import {
  cleanupOrganizationDeep,
  seedGroupMembership,
  seedOrgMembership,
  seedOrganization,
} from '#test/integration/helpers';
import { createNextRequest } from '#test/integration/test-utils';

/**
 * ADR-0015 §7.1 — there is no union of group roles across orgs. `withAuth`
 * resolves the caller's `group_members` rows inside the active org only, so a
 * group in org B never reaches a request scoped to org A, and the same user
 * sees it (with its role) once org B becomes active.
 *
 * Every request runs through the real `withAuth` with a real signed-in session;
 * the only stub is the cookie store Next.js would provide from `next/headers`.
 */
const PASSWORD = 'GrpRole2a4!';

interface Session {
  build: () => SupabaseClient<Database>;
}

async function signIn(email: string): Promise<Session> {
  const jar = new Map<string, string>();
  const build = () =>
    createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => [...jar].map(([name, value]) => ({ name, value })),
          setAll: (cookiesToSet) => {
            for (const { name, value } of cookiesToSet) jar.set(name, value);
          },
        },
      },
    );

  const { error } = await build().auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`[setup] signIn failed for ${email}: ${error.message}`);

  return { build };
}

async function contextFor(session: Session, cookieOrgId?: string): Promise<RequestContext> {
  vi.mocked(supabaseModule.createClient).mockImplementation(() => Promise.resolve(session.build()));
  let seen: RequestContext | undefined;
  const res = await withAuth(
    createNextRequest(
      'http://localhost/api/v1/example',
      { method: 'GET' },
      cookieOrgId ? { active_org_id: cookieOrgId } : undefined,
    ),
    (ctx) => {
      seen = ctx;
      return Promise.resolve(toNextResponse({ success: true, statusCode: 200, data: null }));
    },
  );
  if (!seen) throw new Error(`[setup] withAuth did not reach the handler (status ${res.status})`);
  return seen;
}

describe('withAuth — group roles are scoped to the active org', () => {
  const service = createSeedDb();
  const tag = `${Date.now()}`;

  let orgAId: string;
  let orgBId: string;
  let teacher: Session;
  let teacherUser: TestUserFixture;
  let groupAId: string;
  let groupBId: string;
  /** A second group in org A. The caller is not a member of it. */
  let otherGroupAId: string;
  let otherUser: TestUserFixture;

  beforeAll(async () => {
    const [orgA, orgB] = await Promise.all([
      seedOrganization(`group-roles-2a4-a-${tag}`),
      seedOrganization(`group-roles-2a4-b-${tag}`),
    ]);
    orgAId = orgA.org.id;
    orgBId = orgB.org.id;
    groupAId = orgA.defaultGroupId;
    groupBId = orgB.defaultGroupId;

    teacherUser = await createTestUser({ role: 'educator', password: PASSWORD });
    otherUser = await createTestUser({ role: 'student', password: PASSWORD });

    // The caller is a teacher in A's group and a member in B's group; a second
    // org member takes the opposite role, so no assertion is satisfied by one
    // group's row alone.
    await seedOrgMembership({
      organizationId: orgAId,
      userId: teacherUser.id,
      orgRoleId: orgA.teacherRoleId,
    });
    await seedOrgMembership({
      organizationId: orgBId,
      userId: teacherUser.id,
      orgRoleId: orgB.memberRoleId,
    });
    await seedOrgMembership({
      organizationId: orgAId,
      userId: otherUser.id,
      orgRoleId: orgA.memberRoleId,
    });
    await seedGroupMembership({ groupId: groupAId, userId: teacherUser.id, role: 'teacher' });
    await seedGroupMembership({ groupId: groupBId, userId: teacherUser.id, role: 'member' });

    // Org A holds a group the caller is not in, and `otherUser` is. It is
    // readable through the "Org members read group members" RLS policy but the
    // caller's `user_id` filter must keep it out of the context.
    const { data: otherGroup, error: otherGroupError } = await service
      .from('groups')
      .insert({ organization_id: orgAId, name: `group-roles-2a4-other-${tag}` })
      .select('id')
      .single();
    if (otherGroupError)
      throw new Error(`Failed to create second group: ${otherGroupError.message}`);
    otherGroupAId = otherGroup.id;
    await seedGroupMembership({ groupId: otherGroupAId, userId: otherUser.id, role: 'member' });

    teacher = await signIn(teacherUser.email);
  });

  afterAll(async () => {
    if (orgAId) await cleanupOrganizationDeep(orgAId);
    if (orgBId) await cleanupOrganizationDeep(orgBId);
    for (const user of [teacherUser, otherUser]) {
      await service.auth.admin.deleteUser(user.id).catch(() => {});
    }
  });

  it('reports the caller’s groups in the active org only, with their roles', async () => {
    const inA = await contextFor(teacher, orgAId);
    expect(inA.groupIds).toEqual([groupAId]);
    expect(inA.groupRoles).toEqual({ [groupAId]: 'teacher' });
    expect(inA.groupIds).not.toContain(otherGroupAId);

    const inB = await contextFor(teacher, orgBId);
    expect(inB.groupIds).toEqual([groupBId]);
    expect(inB.groupRoles).toEqual({ [groupBId]: 'member' });
    expect(inB.groupIds).not.toContain(otherGroupAId);
  });

  it('reports no group ids or roles without an active org', async () => {
    const personal = await contextFor(teacher);

    expect(personal.activeOrgId).toBeNull();
    expect(personal.groupIds).toEqual([]);
    expect(personal.groupRoles).toEqual({});
  });
});
