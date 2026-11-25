import type { APIResponse, Page } from '@playwright/test';
import { json } from '#test/helpers/json';
import { FIXTURE_EXPLANATION } from '#test/helpers/question-text';
import { tenantId } from '#test/helpers/tenant-seed';
import { expect, loadTenant, loginAs, test } from '#test/qa/fixtures/tenant';

/**
 * EDU-ASG-11 — kartkówka kolegi z klasy, której uczę (`/edu/assignments`).
 *
 * Case: two teachers of one organization, each teaching one of two classes
 * (`groupTeachers`). Teacher 2 creates two runs with one question and targets
 * them at G1 (the class teacher 1 teaches) and G2 (a class teacher 1 does not
 * teach). Teacher 1's list must show the first and hide the second, and opening
 * the colleague's run must be refused (its composer carries the answer key).
 *
 * Tenant (`content` profile with an explicit roster, declared in
 * `__tests__/qa/profiles/EDU-ASG-11.json`), fresh run suffix per independent run:
 *
 *   bun scripts/qa-tenant.ts EDU-ASG-11 --fresh
 *
 * gives `qa-edu-asg-11-<suffix>` (`tenantKey('qa/cases/EDU-ASG-11.md',
 * 'EDU-ASG-11#<suffix>', 'qa-shared')` + `tenantId` for every org/user/group id).
 * The roster is `manager` (admin), `teacher` and `teacher2` (role `teacher`),
 * `student` (member); `groups: ["G1", "G2"]` and
 * `groupTeachers: { teacher: ["G1"], teacher2: ["G2"] }`. So teacher 1 teaches
 * G1, teacher 2 teaches G2 and stays a plain `member` of the default G1; G2's id
 * is the deterministic `tenantId(key, 'group:2')` the seeder assigns. Both
 * teachers hold `assignment.read` at `group` and the writes at `own` (D29), and
 * the spec builds both runs through the product API inside this tenant — no
 * account, group or run is seeded at runtime, and nothing global is written.
 *
 * Walk record (2026-11-25, `feat/authority-6e` @ a226f8b7) — **code-read, not a
 * browser walk**: this session could not start the served build (the coordinator
 * owns build/serve), so the selectors below come from the components the routes
 * render, not from a screenshot. The cases the walk still owes are named:
 * - the list card is `apps/web/src/app/(frontend)/edu/assignments/assignments-client.tsx`
 *   (`<Link href="/edu/assignments/<id>">` around a card whose title is the run's
 *   `title` and whose badge is `EduAssignmentsPage.draft` → „Szkic”);
 * - the refused detail is `detail-client.tsx`: a `403` leaves `useApiQuery`'s
 *   `data` undefined and renders `AssignmentNotFound` →
 *   „Nie znaleziono kartkówki” + „Powrót do kartkówek”, with no composer. The
 *   composer's own controls (the „Opublikuj” button, the „Wybierz grupy…”
 *   multi-select) and the question text are therefore absent;
 * - `GET /api/v1/teacher/assignments/<id>` must answer 403 (not 404): the RLS
 *   SELECT admits a member of the targeted class, and the service is the
 *   narrower gate (R23).
 *
 * Mutation (proves this spec can fail): the whole taught-group arm of
 * `TeacherAssignmentService.list` deleted (the `else if (scope === 'group' …)`
 * block, replaced by `} else {`), so a group-scope caller falls back to the author
 * filter and this run is no longer on teacher 1's list. The unit-level proof ran
 * through `bun run mutate` on the list-scope case and printed
 * `AssertionError: expected [ 'teacher_assignments' ] to include 'assignment_targets'`
 * (KILLED). The served-app Playwright re-run of this spec under the same mutation
 * belongs to the coordinator's verify pass; this session did not run Playwright.
 */

const CASE = 'EDU-ASG-11';

const POSITIVE_TITLE = 'EDU-ASG-11 obca kartkówka';
const NEGATIVE_TITLE = 'EDU-ASG-11 obca kartkówka (obca klasa)';
const BANK_NAME = 'EDU-ASG-11 bank';
const QUESTION_CONTENT = 'Ziemia jest kulista';
const CORRECT_ANSWER = 'Prawda';

/** Polish copy from `EduAssignmentsPage` / `EduAssignmentDetailPage` (pl.json). */
const COPY = {
  draft: 'Szkic',
  oneQuestion: '1 pytanie',
  notFound: 'Nie znaleziono kartkówki',
  back: 'Powrót do kartkówek',
  publish: 'Opublikuj',
  targetGroups: 'Wybierz grupy...',
} as const;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

async function expectApi<T>(response: APIResponse, label: string): Promise<T> {
  expect(response.status(), label).toBeLessThan(300);
  const body = await json<ApiEnvelope<T>>(response);
  expect(body.success, `${label} response`).toBe(true);
  return body.data;
}

/** One bank with one true/false question, created as the signed-in teacher. */
async function createBankWithQuestion(page: Page): Promise<string> {
  const bank = await expectApi<{ id: string }>(
    await page.request.post('/api/v1/questions/banks', { data: { name: BANK_NAME } }),
    'POST /api/v1/questions/banks',
  );

  const question = await expectApi<{ id: string }>(
    await page.request.post('/api/v1/questions', {
      data: {
        bankId: bank.id,
        type: 'true_false',
        explanation: FIXTURE_EXPLANATION,
        content: QUESTION_CONTENT,
        answers: [
          { content: CORRECT_ANSWER, isCorrect: true, orderIndex: 0 },
          { content: 'Fałsz', isCorrect: false, orderIndex: 1 },
        ],
      },
    }),
    'POST /api/v1/questions',
  );

  return question.id;
}

/**
 * The case's run: a draft with one item, targeted at one class. A draft is enough
 * — the list does not filter by status — and it is the state that would render the
 * composer, which is what makes the refusal assertion in step 5 meaningful.
 */
async function createDraftRun(
  page: Page,
  questionId: string,
  title: string,
  groupId: string,
): Promise<string> {
  const assignment = await expectApi<{ id: string }>(
    await page.request.post('/api/v1/teacher/assignments', { data: { title } }),
    `POST /api/v1/teacher/assignments (${title})`,
  );

  await expectApi<unknown>(
    await page.request.post(`/api/v1/teacher/assignments/${assignment.id}/questions`, {
      data: { questionIds: [questionId] },
    }),
    `POST …/${assignment.id}/questions`,
  );

  // `setTargets` accepts any group of the assignment's organisation, so teacher 2
  // may target the class it does not teach — which is the fixture, not a bug.
  await expectApi<unknown>(
    await page.request.put(`/api/v1/teacher/assignments/${assignment.id}/targets`, {
      data: { groupIds: [groupId] },
    }),
    `PUT …/${assignment.id}/targets`,
  );

  return assignment.id;
}

interface AssignmentRow {
  id: string;
  title: string;
}

test.describe('@case:EDU-ASG-11 @area:EDU @prio:P2 colleague run in the assignment list', () => {
  test('shows the colleague’s run for a taught class, hides the other class’s, and refuses its detail', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const tenant = loadTenant(CASE);
    console.log(`EDU-ASG-11 tenant key: ${tenant.key}`);

    const taughtGroupId = tenant.group?.id;
    if (!taughtGroupId) throw new Error(`${CASE} tenant has no seeded default group`);
    const otherGroupId = tenantId(tenant.key, 'group:2');

    // --- Steps 1–2: teacher 2 builds both runs, each for one class -----------
    await loginAs(page, tenant, 'teacher2', { locale: 'pl' });
    expect(new URL(page.url()).pathname, 'teacher2 lands on /edu').toBe('/edu');

    const questionId = await createBankWithQuestion(page);
    const positiveId = await createDraftRun(page, questionId, POSITIVE_TITLE, taughtGroupId);
    const negativeId = await createDraftRun(page, questionId, NEGATIVE_TITLE, otherGroupId);

    // Control: both runs exist and are theirs, so their absence below is the
    // scope rule, not a missing row.
    const ownRuns = await expectApi<AssignmentRow[]>(
      await page.request.get('/api/v1/teacher/assignments'),
      'GET /api/v1/teacher/assignments (teacher2)',
    );
    const ownIds = ownRuns.map((run) => run.id);
    expect(ownIds, 'the author sees both runs').toEqual(
      expect.arrayContaining([positiveId, negativeId]),
    );

    // --- Steps 3–4: teacher 1 reads the list ---------------------------------
    await loginAs(page, tenant, 'teacher', { locale: 'pl' });
    expect(new URL(page.url()).pathname, 'teacher lands on /edu').toBe('/edu');

    const listResponse = await page.request.get('/api/v1/teacher/assignments');
    expect(listResponse.status(), 'GET /api/v1/teacher/assignments').toBe(200);
    const listed = (await json<ApiEnvelope<AssignmentRow[]>>(listResponse)).data;
    const listedIds = listed.map((run) => run.id);
    expect(listedIds, 'the run for the class teacher 1 teaches').toContain(positiveId);
    expect(listedIds, 'a class teacher 1 does not teach is not read').not.toContain(negativeId);

    await page.goto('/edu/assignments');
    const positiveCard = page.locator(`a[href="/edu/assignments/${positiveId}"]`);
    await expect(positiveCard, 'the colleague’s run is on the list').toHaveCount(1);
    await expect(positiveCard).toContainText(POSITIVE_TITLE);
    await expect(positiveCard).toContainText(COPY.draft);
    await expect(positiveCard, 'the run carries its one item').toContainText(COPY.oneQuestion);
    await expect(
      page.locator(`a[href="/edu/assignments/${negativeId}"]`),
      'the other class’s run is absent',
    ).toHaveCount(0);

    // --- Step 5: the composer stays the author's -----------------------------
    const detailResponse = await page.request.get(`/api/v1/teacher/assignments/${positiveId}`);
    expect(detailResponse.status(), 'the detail is narrower than the list (R23)').toBe(403);

    await page.goto(`/edu/assignments/${positiveId}`);
    await expect(page.getByText(COPY.notFound, { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: COPY.back, exact: true })).toBeVisible();
    // Not the composer, and no key material: the draft's open state would render
    // both if the detail were widened.
    await expect(page.getByRole('button', { name: COPY.publish, exact: true })).toHaveCount(0);
    await expect(page.getByText(COPY.targetGroups, { exact: true })).toHaveCount(0);
    await expect(page.getByText(QUESTION_CONTENT, { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole('heading', { level: 1, name: POSITIVE_TITLE, exact: true }),
    ).toHaveCount(0);
  });
});
