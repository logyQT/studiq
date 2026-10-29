import { expect, test, type Page } from '@playwright/test';
import { createQaSupabase } from '@qa/fixtures/qa-db';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * SEC-06 — a student and a teacher do not manage the organization.
 *
 * Case (verbatim → tenant model): the legacy prerequisite `student1` / `teacher1`
 * (`@dev.local`, password `pass`) is never used. The spec reads its own tenant,
 * seeded fresh for every independent run:
 *
 *   bun scripts/qa-tenant.ts SEC-06 --fresh
 *
 * `__tests__/qa/profiles/SEC-06.json` declares `{ profile: "org-limit", plan: "hub" }`:
 * - `org-limit` gives the organization an admin, the case's `teacher1` (account type
 *   `educator` **with** the system `teacher` org role) and a second teacher, plus the
 *   case's `student1` as a plain `member`, so the teacher's 403 cannot be an artifact
 *   of a member-role caller;
 * - `--plan hub` puts *this tenant's own* organization on Hub through
 *   `apply_org_plan` (the same RPC the billing webhook calls), so the manager
 *   positive control can create a custom role (`role.builder`) and manage members
 *   (`member.manage`). Nothing global is written: no admin setting, feature flag,
 *   plan catalogue row, platform stat or singleton.
 *
 * All ids derive from the tenant (`tenant.runSuffix` + `tenant.users` / `tenant.org`);
 * emails and the control role name carry that run suffix, so two runs never collide.
 *
 * Acceptance points walked on the shared app (:3010, worker qa-env-3):
 * 1. As the **student** (org role `member`, own organization active): `PUT
 *    /organization/members`, `POST /organization/invites/bulk` and `POST
 *    /organization/roles` → **403 FORBIDDEN**, also with an invalid body where the
 *    route gates on the account type (the gate runs before validation: 403, not 422).
 * 2. As the **teacher** (org role `teacher`, Hub plan): `PUT /organization/members`
 *    and `POST /organization/roles` → **403 FORBIDDEN** (missing `member.manage` /
 *    `role.builder` for the teacher role), and a bulk invitation that would grant a
 *    privileged role (`admin`, `teacher`) → **403 FORBIDDEN** (`can_assign_org_role`,
 *    #189).
 * 3. Nothing changed: the organization's `org_members` rows and role ids are exactly
 *    the seeded baseline, no invitation row exists for any address the rejected
 *    attempts used, and no custom role was created.
 *
 * Deliberate deviation from the literal step 2 (verified in the walk, not a defect):
 * an org teacher **may** bulk-invite the plain `member` role — that is the classroom
 * invite flow (#189 "allows an org teacher to invite the member role", see
 * `__tests__/integration/invitations.test.ts`), so the teacher's rejection is scoped
 * to organization management: role changes, custom roles and privileged invitations.
 * The spec asserts that legitimate teacher invite as the "no over-block" control and
 * documents it in the case file.
 *
 * Adjacent regression that matters: the same three calls succeed for the tenant's
 * organization admin on the same active organization (member role change → 200,
 * bulk member invite → 200, custom role → 201), so the 403s above are a permission
 * boundary rather than a broken fixture or route, and the student/teacher panels
 * still load afterwards.
 */

const CASE = 'SEC-06';

const MEMBERS_URL = '/api/v1/organization/members';
const BULK_INVITES_URL = '/api/v1/organization/invites/bulk';
const INVITES_URL = '/api/v1/organization/invites';
const ROLES_URL = '/api/v1/organization/roles';

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface OrgRole {
  id: string;
  name: string;
  isSystem: boolean;
}

interface Member {
  id: string;
  email: string;
  orgRoleName: string;
  orgRoleId: string;
}

interface BulkResult {
  email: string;
  success: true;
  data: { success: true; invitationId: string; inviteLink: string; inviteCode: string };
}

interface MemberRow {
  user_id: string;
  org_role_id: string;
}

interface InvitationRow {
  id: string;
  email: string;
  target_org_role_id: string;
  inviter_id: string | null;
}

interface CallResult {
  status: number;
  errorCode: string | null;
  body: string;
}

/** `GET` an endpoint as the signed-in user and unwrap the `{ success, data }` envelope. */
async function getData<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  expect(response.status(), `GET ${url} → ${response.status()} ${await response.text()}`).toBe(200);
  const body = (await response.json()) as Envelope<T>;
  expect(body.success, `GET ${url} success flag`).toBe(true);
  return body.data as T;
}

async function call(
  page: Page,
  method: 'GET' | 'PUT' | 'POST',
  url: string,
  data?: unknown,
): Promise<CallResult> {
  const response =
    method === 'GET'
      ? await page.request.get(url)
      : method === 'PUT'
        ? await page.request.put(url, { data: data ?? {} })
        : await page.request.post(url, { data: data ?? {} });
  return {
    status: response.status(),
    errorCode: response.headers()['x-error-code'] ?? null,
    body: await response.text(),
  };
}

/**
 * The rejection: 403 with the `FORBIDDEN` code and an envelope that carries no
 * payload — the refused operation must not leak a member, invite or role row.
 */
function expectForbidden(result: CallResult, label: string): void {
  expect(result.status, `${label}: HTTP status`).toBe(403);
  expect(result.errorCode, `${label}: x-error-code header`).toBe('FORBIDDEN');
  expect(JSON.parse(result.body), `${label}: response envelope`).toEqual({
    success: false,
    error: 'FORBIDDEN',
  });
}

/** A fresh session for one tenant user; cookies are cleared so roles never overlap. */
async function switchUser(
  page: Page,
  tenant: QaTenant,
  role: 'manager' | 'teacher' | 'student',
): Promise<void> {
  await page.context().clearCookies();
  await loginAs(page, tenant, role, {
    locale: 'pl',
    waitFor:
      role === 'manager' ? /\/manage(\/|$)/ : role === 'teacher' ? /\/edu(\/|$)/ : /\/app(\/|$)/,
  });
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
}

async function listRoles(page: Page): Promise<OrgRole[]> {
  return getData<OrgRole[]>(page, ROLES_URL);
}

async function listMembers(page: Page): Promise<Member[]> {
  return getData<Member[]>(page, MEMBERS_URL);
}

/**
 * The seeded fixture must be the shape this case needs: a distinct org-`teacher`
 * caller and a plain `member` student, both inside the same Hub organization.
 */
function loadCaseTenant(): QaTenant {
  const tenant = loadTenant(CASE);
  expect(tenant.profile, `${CASE} needs the org-limit tenant profile`).toBe('org-limit');
  expect(tenant.plan, `${CASE} needs role.builder/member.manage (Hub plan)`).toBe('hub');
  if (!tenant.org || !tenant.users.manager || !tenant.users.teacher || !tenant.users.student) {
    throw new Error(`${CASE} tenant is missing its organization, manager, teacher or student`);
  }
  return tenant;
}

test.describe('@case:SEC-06 @area:SEC @prio:P1 student and teacher do not manage the organization', () => {
  test('role changes, bulk invites and custom roles are rejected and leave no rows', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const tenant = loadCaseTenant();
    const org = tenant.org!;
    const teacher = tenant.users.teacher!;
    const student = tenant.users.student!;
    const run = tenant.runSuffix ?? tenant.key.slice(-8);

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const db = createQaSupabase();

    // Distinct addresses and role names per caller and per run, so "no row was
    // created" is an exact statement about this run — never about shared data.
    const email = (who: string, kind: string) => `qa+sec06-${run}-${who}-${kind}@test.local`;
    const studentInviteEmail = email('student', 'invite');
    const studentRoleName = `SEC-06 student role ${run}`;
    const teacherInviteEmail = email('teacher', 'admin-invite');
    const teacherRoleName = `SEC-06 teacher role ${run}`;
    const teacherAllowedEmail = email('teacher', 'member-invite');
    const managerInviteEmail = email('manager', 'member-invite');
    const managerRoleName = `SEC-06 role ${run}`;
    const rejectedEmails = [
      studentInviteEmail,
      teacherInviteEmail,
      email('teacher', 'role-invite'),
    ];

    /** `org_members` rows of this tenant, sorted so the comparison is stable. */
    async function memberSnapshot(): Promise<MemberRow[]> {
      const { data, error } = await db
        .from('org_members')
        .select('user_id, org_role_id')
        .eq('organization_id', org.id)
        .order('user_id');
      expect(error, 'reading the tenant org_members rows').toBeNull();
      return (data ?? []) as MemberRow[];
    }

    /** Invitation rows of this tenant for the addresses the case uses. */
    async function invitationsFor(emails: string[]): Promise<InvitationRow[]> {
      const { data, error } = await db
        .from('invitations')
        .select('id, email, target_org_role_id, inviter_id')
        .eq('organization_id', org.id)
        .in('email', emails);
      expect(error, 'reading the tenant invitation rows').toBeNull();
      return (data ?? []) as InvitationRow[];
    }

    // --- Step 0: the manager resolves the tenant's own roles and baseline ----
    await switchUser(page, tenant, 'manager');

    const roles = await listRoles(page);
    const roleId = (name: 'admin' | 'teacher' | 'member') => {
      const role = roles.find((row) => row.name === name && row.isSystem);
      expect(role, `the organization has its system ${name} role`).toBeTruthy();
      return role!.id;
    };
    const adminRoleId = roleId('admin');
    const teacherRoleId = roleId('teacher');
    const memberRoleId = roleId('member');

    const membersBefore = await listMembers(page);
    const studentMember = membersBefore.find((row) => row.id === student.id);
    const teacherMember = membersBefore.find((row) => row.id === teacher.id);
    expect(studentMember?.orgRoleName, 'the student is a plain org member').toBe('member');
    expect(teacherMember?.orgRoleName, 'the case teacher is a real org teacher').toBe('teacher');

    const baseline = await memberSnapshot();
    expect(baseline.length, 'the org-limit tenant has four members').toBe(4);

    // --- Step 1: the student ------------------------------------------------
    await switchUser(page, tenant, 'student');

    const me = await page.request.get('/api/v1/auth/me');
    expect(me.status(), 'GET /api/v1/auth/me as the student').toBe(200);
    const meBody = (await me.json()) as {
      data?: { user?: { id?: string; app_metadata?: { account_type?: string } } };
    };
    expect(meBody.data?.user?.id, 'the signed-in user is the case subject').toBe(student.id);
    expect(meBody.data?.user?.app_metadata?.account_type, 'the case subject is a student').toBe(
      'student',
    );

    // The student has a real tenant scope: the 403s below are a permission
    // boundary, not "authenticated with no organization".
    const studentOrgs = await getData<
      Array<{ id: string; orgRoleName: string; isActive: boolean }>
    >(page, '/api/v1/me/orgs');
    expect(
      studentOrgs.find((row) => row.id === org.id),
      'the student’s own organization is the active tenant scope',
    ).toMatchObject({ id: org.id, orgRoleName: 'member', isActive: true });

    // PUT /api/v1/organization/members — before validation (route account rule).
    expectForbidden(
      await call(page, 'PUT', MEMBERS_URL, {
        targetUserId: student.id,
        newOrgRoleId: teacherRoleId,
      }),
      'student PUT /organization/members',
    );
    expectForbidden(
      await call(page, 'PUT', MEMBERS_URL, {}),
      'student PUT /organization/members with an invalid body',
    );

    // POST /api/v1/organization/invites/bulk — the gate is the caller's account
    // type and org membership, checked before any write.
    expectForbidden(
      await call(page, 'POST', BULK_INVITES_URL, {
        invitations: [{ email: studentInviteEmail, targetOrgRoleId: memberRoleId }],
      }),
      'student POST /organization/invites/bulk',
    );

    // POST /api/v1/organization/roles — before validation.
    expectForbidden(
      await call(page, 'POST', ROLES_URL, { name: studentRoleName }),
      'student POST /organization/roles',
    );
    expectForbidden(
      await call(page, 'POST', ROLES_URL, {}),
      'student POST /organization/roles with an invalid body',
    );

    // --- Step 2: the teacher ------------------------------------------------
    await switchUser(page, tenant, 'teacher');

    const teacherMe = await page.request.get('/api/v1/auth/me');
    expect(teacherMe.status(), 'GET /api/v1/auth/me as the teacher').toBe(200);
    const teacherMeBody = (await teacherMe.json()) as {
      data?: { user?: { id?: string; app_metadata?: { account_type?: string } } };
    };
    expect(teacherMeBody.data?.user?.id, 'the signed-in user is the case teacher').toBe(teacher.id);
    expect(
      teacherMeBody.data?.user?.app_metadata?.account_type,
      'the case teacher is an educator',
    ).toBe('educator');

    const teacherOrgs = await getData<
      Array<{ id: string; orgRoleName: string; isActive: boolean }>
    >(page, '/api/v1/me/orgs');
    expect(
      teacherOrgs.find((row) => row.id === org.id),
      'the teacher holds the org teacher role in the active organization',
    ).toMatchObject({ id: org.id, orgRoleName: 'teacher', isActive: true });

    // A real role change is refused: the teacher lacks `member.manage`.
    expectForbidden(
      await call(page, 'PUT', MEMBERS_URL, {
        targetUserId: student.id,
        newOrgRoleId: teacherRoleId,
      }),
      'teacher PUT /organization/members',
    );
    expectForbidden(
      await call(page, 'PUT', MEMBERS_URL, {}),
      'teacher PUT /organization/members with an invalid body',
    );

    // A custom role is refused: the teacher lacks `role.builder`.
    expectForbidden(
      await call(page, 'POST', ROLES_URL, { name: teacherRoleName }),
      'teacher POST /organization/roles',
    );
    expectForbidden(
      await call(page, 'POST', ROLES_URL, {}),
      'teacher POST /organization/roles with an invalid body',
    );

    // Privileged invitations are refused: a teacher may grant the plain `member`
    // role only, never `admin`/`teacher` (#189).
    expectForbidden(
      await call(page, 'POST', BULK_INVITES_URL, {
        invitations: [{ email: teacherInviteEmail, targetOrgRoleId: adminRoleId }],
      }),
      'teacher POST /organization/invites/bulk with the admin role',
    );
    expectForbidden(
      await call(page, 'POST', BULK_INVITES_URL, {
        invitations: [
          {
            email: email('teacher', 'role-invite'),
            targetOrgRoleId: teacherRoleId,
          },
        ],
      }),
      'teacher POST /organization/invites/bulk with the teacher role',
    );

    // --- "brak zmian ról/zaproszeń/ról niestandardowych" -------------------
    expect(await memberSnapshot(), 'no role change was applied').toEqual(baseline);

    expect(await invitationsFor(rejectedEmails), 'the rejected invitations left no rows').toEqual(
      [],
    );

    const rejectedRoles = await listRoles(page);
    expect(
      rejectedRoles.filter((row) => row.name === studentRoleName || row.name === teacherRoleName),
      'the rejected role creations left no rows',
    ).toEqual([]);
    expect(
      rejectedRoles.map((row) => row.id).sort(),
      'the organization still has exactly its three system roles',
    ).toEqual([adminRoleId, memberRoleId, teacherRoleId].sort());

    // --- No over-block: the teacher's own panel still loads ----------------
    await page.goto('/edu');
    await expect(page).toHaveURL(/\/edu(\/|$)/, { timeout: 20_000 });

    // --- Adjacent control: the teacher's classroom invite still works ------
    // Deliberate deviation from the literal case step 2, confirmed in the walk:
    // an org teacher may invite the plain `member` role (#189); only organization
    // management and privileged grants are forbidden.
    const teacherInvite = await call(page, 'POST', BULK_INVITES_URL, {
      invitations: [{ email: teacherAllowedEmail, targetOrgRoleId: memberRoleId }],
    });
    expect(
      teacherInvite.status,
      `teacher bulk invite with the member role → ${teacherInvite.body}`,
    ).toBe(200);
    const teacherInviteBody = JSON.parse(teacherInvite.body) as Envelope<{ results: BulkResult[] }>;
    expect(teacherInviteBody.success).toBe(true);
    expect(teacherInviteBody.data?.results).toHaveLength(1);
    expect(teacherInviteBody.data?.results[0]).toMatchObject({
      email: teacherAllowedEmail,
      success: true,
    });

    expect(await invitationsFor([teacherAllowedEmail])).toEqual([
      {
        id: teacherInviteBody.data!.results[0].data.invitationId,
        email: teacherAllowedEmail,
        target_org_role_id: memberRoleId,
        inviter_id: teacher.id,
      },
    ]);

    // --- Positive control: the admin may do all three operations ------------
    await switchUser(page, tenant, 'manager');

    const managerInvite = await call(page, 'POST', BULK_INVITES_URL, {
      invitations: [{ email: managerInviteEmail, targetOrgRoleId: memberRoleId }],
    });
    expect(managerInvite.status, `manager bulk invite → ${managerInvite.body}`).toBe(200);
    const managerInviteBody = JSON.parse(managerInvite.body) as Envelope<{
      results: BulkResult[];
    }>;
    expect(managerInviteBody.success).toBe(true);

    const promote = await call(page, 'PUT', MEMBERS_URL, {
      targetUserId: student.id,
      newOrgRoleId: teacherRoleId,
    });
    expect(promote.status, `manager promotes the student → ${promote.body}`).toBe(200);
    expect(
      (await listMembers(page)).find((row) => row.id === student.id),
      'the manager’s role change is applied',
    ).toMatchObject({ id: student.id, orgRoleName: 'teacher', orgRoleId: teacherRoleId });

    const demote = await call(page, 'PUT', MEMBERS_URL, {
      targetUserId: student.id,
      newOrgRoleId: memberRoleId,
    });
    expect(demote.status, `manager demotes the student → ${demote.body}`).toBe(200);
    expect(
      (await listMembers(page)).find((row) => row.id === student.id),
      'the manager’s role change is reverted',
    ).toMatchObject({ id: student.id, orgRoleName: 'member', orgRoleId: memberRoleId });

    const roleResponse = await call(page, 'POST', ROLES_URL, {
      name: managerRoleName,
      description: `SEC-06 control role ${run}`,
    });
    expect(roleResponse.status, `manager POST /organization/roles → ${roleResponse.body}`).toBe(
      201,
    );
    const createdRole = (JSON.parse(roleResponse.body) as Envelope<OrgRole>).data!;
    expect(createdRole).toMatchObject({ name: managerRoleName, isSystem: false });

    const rolesAfter = await listRoles(page);
    expect(
      rolesAfter.filter((row) => row.id === createdRole.id),
      'the control role is listed for the organization',
    ).toMatchObject([{ id: createdRole.id, name: managerRoleName, isSystem: false }]);

    // --- Final state: exactly the two allowed invitations, nothing else ----
    expect(await memberSnapshot(), 'the organization’s roles are back at the baseline').toEqual(
      baseline,
    );

    expect(
      await invitationsFor([studentInviteEmail]),
      'the student still created no invitation',
    ).toEqual([]);
    expect(
      await invitationsFor([teacherInviteEmail, email('teacher', 'role-invite')]),
      'the teacher created no privileged invitation',
    ).toEqual([]);

    const allowedInvites = await invitationsFor([teacherAllowedEmail, managerInviteEmail]);
    expect(
      allowedInvites.map((row) => ({
        email: row.email,
        target_org_role_id: row.target_org_role_id,
      })),
      'only the two allowed member invitations exist',
    ).toEqual(
      expect.arrayContaining([
        { email: teacherAllowedEmail, target_org_role_id: memberRoleId },
        { email: managerInviteEmail, target_org_role_id: memberRoleId },
      ]),
    );
    expect(allowedInvites, 'exactly two allowed invitations').toHaveLength(2);

    // The invitation list the manager UI reads contains both allowed rows.
    const pending = await getData<Array<{ email: string; orgRoleName: string }>>(page, INVITES_URL);
    expect(pending.map((row) => row.email)).toEqual(
      expect.arrayContaining([teacherAllowedEmail, managerInviteEmail]),
    );

    // The manager's own panel still loads with the created role in it.
    await page.goto('/manage/roles');
    await expect(page).toHaveURL(/\/manage\/roles$/, { timeout: 20_000 });
    await expect(page.getByText(managerRoleName, { exact: true }).first()).toBeVisible();

    expect(pageErrors, 'uncaught page errors during the walk').toEqual([]);
  });
});
