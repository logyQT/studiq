import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type BeforeResult,
  before,
  createTestUser,
  type TestUserFixture,
} from '#test/helpers/test-user';
import { cleanupOrganizationDeep, createServiceClient, mockUser } from '#test/integration/helpers';
import { createNextRequest } from '#test/integration/test-utils';
import { GET as listTeacherQuizzes } from '@/app/(backend)/api/v1/teacher/quizzes/route';

/**
 * #147 — `GET /api/v1/teacher/quizzes` answered 500 INTERNAL_SERVER when the
 * caller had no active organization: `ctx.activeOrgId` was `null`, postgrest
 * serialised it as `organization_id=eq.null`, Postgres raised 22P02 on the uuid
 * column and the unmapped error fell through to INTERNAL_SERVER.
 *
 * The unit suite mocks the Supabase client, so it can only prove the guard
 * short-circuits. This file runs the real `withAuth → controller → service →
 * PostgREST` stack, which is the only layer that reproduces the 22P02 failure.
 */
const BASE_URL = 'http://localhost';

describe('GET /api/v1/teacher/quizzes without an active organization (#147)', () => {
  const service = createServiceClient();
  const tag = `${Date.now()}`;

  let orgLessEducator!: TestUserFixture;
  let orgEducator!: BeforeResult;
  let outsiderEducator!: TestUserFixture;

  beforeAll(async () => {
    // Confirmed educator who never onboarded: no `org_members` row at all.
    orgLessEducator = await createTestUser({ role: 'educator' });
    // Educator who does belong to an org — the happy path must keep working.
    orgEducator = await before({ role: 'educator', org: `quiz-no-org-${tag}` });
    // Educator with no membership in orgEducator's org — forged-cookie case.
    outsiderEducator = await createTestUser({ role: 'educator' });
  });

  afterAll(async () => {
    if (orgEducator?.orgId) await cleanupOrganizationDeep(orgEducator.orgId);
    for (const user of [orgLessEducator, orgEducator?.user, outsiderEducator]) {
      if (user?.id) await service.auth.admin.deleteUser(user.id).catch(() => {});
    }
  });

  it('returns 403 instead of 500 when the caller has no active organization', async () => {
    mockUser(orgLessEducator);

    const res = await listTeacherQuizzes(
      createNextRequest(`${BASE_URL}/api/v1/teacher/quizzes`, { method: 'GET' }),
    );
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({ success: false, error: 'FORBIDDEN' });
  });

  it('returns 200 for an org member with a valid active_org_id cookie', async () => {
    mockUser(orgEducator.user);

    const res = await listTeacherQuizzes(
      createNextRequest(
        `${BASE_URL}/api/v1/teacher/quizzes`,
        { method: 'GET' },
        { active_org_id: orgEducator.orgId! },
      ),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
  });

  it('returns 403 for a forged active_org_id cookie from a non-member', async () => {
    mockUser(outsiderEducator);

    const res = await listTeacherQuizzes(
      createNextRequest(
        `${BASE_URL}/api/v1/teacher/quizzes`,
        { method: 'GET' },
        { active_org_id: orgEducator.orgId! },
      ),
    );
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({ success: false, error: 'FORBIDDEN' });
  });
});
