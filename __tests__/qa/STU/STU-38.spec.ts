import { expect, test, type Page } from '@playwright/test';
import { loadTenant, loginAs } from '@qa/fixtures/qa-tenant';

/**
 * STU-38 — a quiz („kartkówka”) addressed to another group stays closed to a
 * student outside that group.
 *
 * Case steps: copy the URL of another group's assignment and open it as a
 * student who is not in that group. Expected result: „Nie znaleziono
 * kartkówki” — no data and no way to start it.
 *
 * Tenant (deterministic, `content` profile, fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts STU-38 --fresh
 *
 * gives the org `qa-stu-38-<suffix>` with an `admin` manager, an `educator`
 * teacher, a student and the default group `G1` (which holds the student), all
 * derived from `tenantKey('qa/cases/STU-38.md', 'STU-38#<suffix>', 'qa-shared')`
 * + `tenantId(key, entity)`. The case's legacy account (`student1@dev.local`,
 * password `pass`) is never used. Nothing global is read or written: no admin
 * setting, feature flag, plan, platform stat or singleton row.
 *
 * The prerequisite „Kartkówka skierowana do innej grupy” is built inside this
 * tenant through the product API:
 * 1. the tenant's manager creates a second group of the same organization and
 *    makes the tenant teacher its teacher member — the group picker only offers
 *    teacher-led groups, and the student belongs to `G1`, not to this one;
 * 2. the tenant's teacher creates one question and two published assignments
 *    from it: the „foreign” one targeted at that second group, and a control one
 *    targeted at the student's own `G1`.
 * The second group is reused by name on a retry against the same tenant, so the
 * spec never grows the org past its group limit. Every assignment id comes from
 * those API calls, never from a hard-coded uuid.
 *
 * Acceptance points (confirmed on the shared app during the walk, Polish UI):
 * 1. `/app/assignments/<foreign-id>` renders „Nie znaleziono kartkówki” — the
 *    title, the question/points cards and the „Rozpocznij kartkówkę” action are
 *    all absent, so there is nothing to read and nothing to start.
 * 2. `GET /api/v1/assignments/<foreign-id>` answers 404 `NOT_FOUND` and
 *    `POST /api/v1/assignments/<foreign-id>/start` answers 404 `NOT_FOUND`, so no
 *    attempt can be created through the API either.
 * 3. The student's list (`/app/assignments` and `GET /api/v1/assignments`) never
 *    mentions the foreign assignment.
 * 4. Adjacent regression: the control assignment addressed to the student's own
 *    group is listed and its detail page renders with the title and the
 *    „Rozpocznij kartkówkę” action — the hidden quiz is hidden by its audience,
 *    not because the student session or the assignment plumbing is broken.
 */

const CASE = 'STU-38';

/** Polish copy from `AppAssignmentDetailPage` / `AppAssignmentsPage` (pl.json). */
const COPY = {
  listTitle: 'Moje kartkówki',
  notFound: 'Nie znaleziono kartkówki',
  start: 'Rozpocznij kartkówkę',
} as const;

/** The second group of the tenant's organization: the student is not in it. */
const FOREIGN_GROUP_NAME = 'STU-38 inna grupa';

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface GroupRow {
  id: string;
  name: string;
}

interface QuestionRow {
  id: string;
  content: string;
}

interface AssignmentDetail {
  id: string;
  title: string;
  status: 'draft' | 'published';
  question_count: number;
}

/** `GET` an endpoint as the signed-in user and unwrap the response envelope. */
async function getData<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  expect(response.ok(), `GET ${url} → ${response.status()} ${await response.text()}`).toBe(true);
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(body.success, `GET ${url} success flag`).toBe(true);
  return body.data;
}

/**
 * The other group of the tenant's org. Created once per tenant and reused by
 * name, so a retry (CI seeds one tenant and retries against it) never hits the
 * plan's group limit. The teacher is seeded as the group's teacher member,
 * because `/api/v1/organization/groups` only lists teacher-led groups.
 */
async function ensureForeignGroup(page: Page, teacherId: string, name: string): Promise<string> {
  const groups = await getData<GroupRow[]>(page, '/api/v1/organization/groups');
  let id = groups.find((group) => group.name === name)?.id;

  if (!id) {
    const created = await page.request.post('/api/v1/organization/groups', { data: { name } });
    expect(
      created.status(),
      `POST /api/v1/organization/groups (${name}) → ${created.status()} ${await created.text()}`,
    ).toBe(201);
    id = ((await created.json()) as ApiEnvelope<GroupRow>).data.id;
  }

  const members = await page.request.put(`/api/v1/organization/groups/${id}/members`, {
    data: { members: [{ userId: teacherId, role: 'teacher' }] },
  });
  expect(
    members.status(),
    `PUT /api/v1/organization/groups/${id}/members → ${members.status()} ${await members.text()}`,
  ).toBe(200);
  return id;
}

/** A question bank of this tenant, created once and reused by later runs. */
async function ensureBank(page: Page, name: string): Promise<string> {
  const banks = await getData<{ items: { id: string; name: string }[] }>(
    page,
    '/api/v1/questions/banks?limit=100',
  );
  const existing = banks.items.find((bank) => bank.name === name);
  if (existing) return existing.id;

  const created = await page.request.post('/api/v1/questions/banks', { data: { name } });
  expect(created.status(), 'POST /api/v1/questions/banks').toBe(201);
  return ((await created.json()) as ApiEnvelope<{ id: string }>).data.id;
}

/** One multiple-choice question inside the bank, keyed by content. */
async function ensureQuestion(page: Page, bankId: string, content: string): Promise<string> {
  const questions = await getData<QuestionRow[]>(page, `/api/v1/questions?bankId=${bankId}`);
  const existing = questions.find((question) => question.content === content);
  if (existing) return existing.id;

  const created = await page.request.post('/api/v1/questions', {
    data: {
      bankId,
      type: 'mcq',
      content,
      answers: [
        { content: 'Odpowiedź A', isCorrect: true, orderIndex: 0 },
        { content: 'Odpowiedź B', isCorrect: false, orderIndex: 1 },
      ],
    },
  });
  expect(
    created.status(),
    `POST /api/v1/questions (${content}) → ${created.status()} ${await created.text()}`,
  ).toBe(201);
  return ((await created.json()) as ApiEnvelope<QuestionRow>).data.id;
}

/** Create, fill and publish an assignment addressed to exactly one group. */
async function publishAssignment(
  page: Page,
  params: { title: string; groupId: string; questionId: string },
): Promise<string> {
  const { title, groupId, questionId } = params;
  const created = await page.request.post('/api/v1/teacher/assignments', {
    data: { title, shuffleQuestions: false, shuffleAnswers: false },
  });
  expect(
    created.status(),
    `POST /api/v1/teacher/assignments (${title}) → ${created.status()} ${await created.text()}`,
  ).toBe(201);
  const id = ((await created.json()) as ApiEnvelope<AssignmentDetail>).data.id;

  const added = await page.request.post(`/api/v1/teacher/assignments/${id}/questions`, {
    data: { questionIds: [questionId] },
  });
  expect(added.status(), `POST /api/v1/teacher/assignments/${id}/questions`).toBe(200);

  const targeted = await page.request.put(`/api/v1/teacher/assignments/${id}/targets`, {
    data: { groupIds: [groupId] },
  });
  expect(
    targeted.status(),
    `PUT /api/v1/teacher/assignments/${id}/targets → ${targeted.status()} ${await targeted.text()}`,
  ).toBe(200);

  const published = await page.request.post(`/api/v1/teacher/assignments/${id}/publish`, {
    data: {},
  });
  expect(
    published.status(),
    `POST /api/v1/teacher/assignments/${id}/publish → ${published.status()} ${await published.text()}`,
  ).toBe(200);
  expect(
    ((await published.json()) as ApiEnvelope<AssignmentDetail>).data.status,
    'the prerequisite is a published assignment',
  ).toBe('published');

  const detail = await getData<AssignmentDetail>(page, `/api/v1/teacher/assignments/${id}`);
  expect(detail.question_count, 'the published assignment holds its question').toBe(1);
  return id;
}

test.describe('@case:STU-38 @area:STU @prio:P2 assignment of another group', () => {
  test('a student outside the target group gets „Nie znaleziono kartkówki” and cannot start it', async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(180_000);

    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    const teacher = tenant.users.teacher;
    if (!tenant.org || !tenant.group || !teacher) {
      throw new Error(`${CASE} needs the content tenant profile (org, group and teacher)`);
    }

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // A per-execution tag keeps repeated runs against the same tenant apart.
    const runTag = `${tenant.runSuffix ?? 'stable'}-${Date.now().toString(36)}`;
    const foreignTitle = `STU-38 kartkówka innej grupy ${runTag}`;
    const ownTitle = `STU-38 kartkówka własnej grupy ${runTag}`;

    // ── Manager: the case's other group of the same organization ───────────
    await loginAs(page, tenant, 'manager', { locale: 'pl', waitFor: /\/manage(\/|$)/ });
    const foreignGroupId = await ensureForeignGroup(page, teacher.id, FOREIGN_GROUP_NAME);
    expect(foreignGroupId, 'the second group is a different group than the student’s own').not.toBe(
      tenant.group.id,
    );

    // ── Teacher: one question, two assignments (foreign group / own group) ──
    await loginAs(page, tenant, 'teacher', { locale: 'pl', waitFor: /\/edu(\/|$)/ });
    expect(new URL(page.url()).pathname, 'the educator lands on /edu').toBe('/edu');

    const groups = await getData<GroupRow[]>(page, '/api/v1/organization/groups');
    expect(
      groups.map((group) => group.id),
      'the second group is a real, teacher-visible group of this organization',
    ).toContain(foreignGroupId);
    expect(
      groups.map((group) => group.id),
      'the student’s own group is part of the same set',
    ).toContain(tenant.group.id);

    const bankId = await ensureBank(page, `STU-38 bank ${tenant.runSuffix ?? 'stable'}`);
    const questionId = await ensureQuestion(page, bankId, `STU-38 pytanie ${runTag}`);
    const foreignId = await publishAssignment(page, {
      title: foreignTitle,
      groupId: foreignGroupId,
      questionId,
    });
    const ownId = await publishAssignment(page, {
      title: ownTitle,
      groupId: tenant.group.id,
      questionId,
    });

    // ── Student: the foreign assignment is invisible and closed ─────────────
    const studentContext = await browser.newContext({ baseURL });
    try {
      const studentPage = await studentContext.newPage();
      const studentErrors: string[] = [];
      studentPage.on('pageerror', (error) => studentErrors.push(error.message));

      await loginAs(studentPage, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });
      expect(new URL(studentPage.url()).pathname, 'the student lands on /app').toBe('/app');

      // The list only carries assignments addressed to this student.
      const assigned = await getData<{ id: string }[]>(studentPage, '/api/v1/assignments');
      const assignedIds = assigned.map((assignment) => assignment.id);
      expect(assignedIds, 'the assignment of the other group is not listed').not.toContain(
        foreignId,
      );
      expect(assignedIds, 'the assignment of the student’s own group is listed').toContain(ownId);

      await studentPage.goto('/app/assignments');
      await expect(studentPage.locator('h1')).toHaveText(COPY.listTitle);
      const ownCard = studentPage.locator(`a[href="/app/assignments/${ownId}"]`);
      await expect(ownCard, 'the own-group assignment is listed').toBeVisible();
      await expect(ownCard).toContainText(ownTitle);
      await expect(
        studentPage.getByText(foreignTitle, { exact: true }),
        'the other group’s assignment is not listed',
      ).toHaveCount(0);
      await expect(
        studentPage.locator(`a[href="/app/assignments/${foreignId}"]`),
        'no card links to the other group’s assignment',
      ).toHaveCount(0);

      // Step 1: copy the URL of the other group's assignment and open it.
      await studentPage.goto(`/app/assignments/${foreignId}`);
      await expect(studentPage).toHaveURL(new RegExp(`/app/assignments/${foreignId}$`));
      await expect(
        studentPage.getByText(COPY.notFound, { exact: true }),
        'the page answers with the case’s copy',
      ).toBeVisible();
      await expect(
        studentPage.getByRole('heading', { name: foreignTitle }),
        'no assignment data is rendered',
      ).toHaveCount(0);
      await expect(
        studentPage.getByRole('button', { name: COPY.start }),
        'there is no way to start the assignment',
      ).toHaveCount(0);

      // The API is closed too — not only the rendered page.
      const detail = await studentPage.request.get(`/api/v1/assignments/${foreignId}`);
      expect(detail.status(), 'GET the foreign assignment as the student').toBe(404);
      expect(((await detail.json()) as { error: string }).error).toBe('NOT_FOUND');

      const start = await studentPage.request.post(`/api/v1/assignments/${foreignId}/start`);
      expect(start.status(), 'starting the foreign assignment as the student').toBe(404);
      expect(((await start.json()) as { error: string }).error).toBe('NOT_FOUND');

      const after = await getData<{ id: string }[]>(studentPage, '/api/v1/assignments');
      expect(
        after.map((assignment) => assignment.id),
        'no attempt turned the foreign assignment into a listed one',
      ).not.toContain(foreignId);

      // Adjacent regression: the same student can open the own-group assignment.
      await studentPage.goto(`/app/assignments/${ownId}`);
      await expect(studentPage.locator('h1')).toHaveText(ownTitle);
      await expect(
        studentPage.getByRole('button', { name: COPY.start }),
        'the own-group assignment offers „Rozpocznij kartkówkę”',
      ).toBeVisible();

      expect(studentErrors, 'uncaught page errors in the student session').toEqual([]);
    } finally {
      await studentContext.close();
    }

    expect(pageErrors, 'uncaught page errors in the manager/teacher session').toEqual([]);
  });
});
