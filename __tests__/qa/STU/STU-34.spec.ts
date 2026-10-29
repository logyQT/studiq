import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * STU-34 — Lista kartkówek (`/app/assignments`).
 *
 * Case steps: open `/app/assignments` as the student.
 *
 * Tenant (deterministic `content` profile, fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts STU-34 --fresh
 *
 * gives the org `qa-stu-34-<suffix>` with a manager, an educator and the student, plus
 * the default group `G1` (`tenantKey('qa/cases/STU-34.md', 'STU-34#<suffix>', 'qa-shared')`
 * + `tenantId` for every id). The legacy manual accounts (`student-classroom@dev.local`,
 * `password` `pass`) are never used.
 *
 * The case's prerequisite — „Opublikowana kartkówka dla klasy” — is built through the
 * product API inside this tenant, never from a shared seed:
 *
 * - „STU-34 grupowa” — 2 mcq questions, 1 point each, deadline +3 days, time limit
 *   10 min, max attempts 1, published to the tenant group `G1` (the student's group);
 * - „STU-34 indywidualna” — 1 question, deadline +5 days, max attempts 2, published to
 *   the student directly (so the second attempt can stay open: „W trakcie”);
 * - „STU-34 obca grupa” — 1 question, published to a second group of the same org with
 *   no members, so the student must never see it (isolation);
 * - „STU-34 szkic” — a draft targeted at `G1` but never published, also invisible.
 *
 * The second group needs `group.manage`, which the tenant educator does not have (its
 * org role is `member`), so the spec creates it as the tenant's manager — the same
 * person who owns the org. The group is reused by name on a retried run.
 *
 * Re-running on the same tenant stays deterministic: the spec deletes every assignment
 * of this tenant at the start (only rows this spec owns — the tenant is its own), then
 * recreates the four assignments with fixed titles. A CI retry therefore starts from
 * the same empty state as the first attempt, which is what makes the empty-state
 * assertion safe.
 *
 * Acceptance points (walked on the shared app, Polish UI, 2026-10-29):
 * 1. With no assignments the page shows the empty state „Brak kartkówek” /
 *    „Nie masz oczekujących kartkówek od nauczycieli” and no section heading.
 * 2. Published group- and student-targeted quizzes appear under „Oczekujące (N)”, each
 *    card with its title, „N pytań · M punktów”, „Termin: <dd.mm.yyyy>” and — for the
 *    multi-attempt quiz — „Pozostało prób: 2/2”.
 * 3. A started attempt leaves „Oczekujące” and renders its own „W trakcie” section
 *    (the fix for issue #368); the pending counter drops accordingly.
 * 4. A quiz whose attempts are used up moves to „Ukończone (N)” with its score and
 *    „Ukończono: <dd.mm.yyyy>”; „Oczekujące” is gone.
 * 5. The draft and the quiz targeted at another group never appear — neither on the
 *    page nor in `GET /api/v1/assignments`.
 */

const CASE = 'STU-34';

const TITLE_GROUP = 'STU-34 grupowa';
const TITLE_INDIVIDUAL = 'STU-34 indywidualna';
const TITLE_OUTSIDER = 'STU-34 obca grupa';
const TITLE_DRAFT = 'STU-34 szkic';
const BANK_NAME = 'STU-34 bank';
const OUTSIDER_GROUP = 'STU-34 obca grupa uczniów';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Polish copy from `AppAssignmentsPage` (pl.json), as confirmed in the walk. */
const COPY = {
  title: 'Moje kartkówki',
  empty: 'Brak kartkówek',
  emptyDescription: 'Nie masz oczekujących kartkówek od nauczycieli',
  pending: /^Oczekujące \(\d+\)$/i,
  inProgress: /^W trakcie$/i,
  completed: /^Ukończone \(\d+\)$/i,
} as const;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error?: string;
}

interface BankRow {
  id: string;
  name: string;
}

interface QuestionRow {
  id: string;
}

interface AssignmentDetail {
  id: string;
  title: string;
  status: 'draft' | 'published';
  deadline: string | null;
  question_count: number;
  total_points: number;
}

interface GroupRow {
  id: string;
  name: string;
  canManage?: boolean;
}

interface StartedAttempt {
  id: string;
  questions: Array<{
    id: string;
    question_answers: Array<{ id: string; content: string }>;
  }>;
}

interface StudentAssignmentRow {
  id: string;
  title: string;
  question_count: number;
  total_points: number;
  max_attempts: number;
  attempts_used: number;
  last_completed_attempt: { score: number; total_points: number | null } | null;
}

/** One API call through the signed-in page, asserting the expected status and envelope. */
async function call<T>(
  page: Page,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  data?: unknown,
  expected: number | number[] = 200,
): Promise<T> {
  const response = await page.request.fetch(url, {
    method,
    ...(data === undefined ? {} : { data }),
  });
  const text = await response.text();
  expect([expected].flat(), `${method} ${url} → ${response.status()} ${text}`).toContain(
    response.status(),
  );
  const body = JSON.parse(text) as ApiEnvelope<T>;
  expect(body.success, `${method} ${url} success flag`).toBe(true);
  return body.data;
}

/** The page content — the dashboard shell nests the route in the last `<main>`. */
function content(page: Page): Locator {
  return page.locator('main').last();
}

/** The section whose `<h2>` is the given heading (the heading text is CSS-uppercased). */
function section(page: Page, heading: RegExp): Locator {
  return page
    .locator('section')
    .filter({ has: page.getByRole('heading', { level: 2, name: heading }) });
}

/** The card link for one assignment id. */
function assignmentCard(page: Page, id: string): Locator {
  return page.locator(`a[href="/app/assignments/${id}"]`);
}

/** The date the list renders for an ISO timestamp, in the browser's locale/timezone. */
async function datePl(page: Page, iso: string): Promise<string> {
  return page.evaluate((value) => new Date(value).toLocaleDateString('pl'), iso);
}

/** Delete every assignment of this tenant (only rows this spec created). */
async function clearAssignments(page: Page): Promise<void> {
  const rows = await call<AssignmentDetail[]>(page, 'GET', '/api/v1/teacher/assignments');
  for (const row of rows) {
    await call<null>(
      page,
      'DELETE',
      `/api/v1/teacher/assignments/${row.id}`,
      undefined,
      [200, 204],
    );
  }
  await expect
    .poll(
      async () =>
        (await call<AssignmentDetail[]>(page, 'GET', '/api/v1/teacher/assignments')).length,
      {
        message: 'the tenant starts without assignments',
      },
    )
    .toBe(0);
}

/** The group with no members, used to prove the list is scoped to the student. */
async function ensureOutsiderGroup(page: Page): Promise<string> {
  const groups = await call<GroupRow[]>(page, 'GET', '/api/v1/organization/groups');
  const existing = groups.find((group) => group.name === OUTSIDER_GROUP);
  if (existing) return existing.id;

  const created = await call<GroupRow>(
    page,
    'POST',
    '/api/v1/organization/groups',
    { name: OUTSIDER_GROUP, description: 'STU-34 isolation group' },
    201,
  );
  return created.id;
}

/** The case bank, created once and reused on retries (its questions are this run's). */
async function ensureBank(page: Page): Promise<string> {
  const banks = await call<{ items: BankRow[] }>(
    page,
    'GET',
    '/api/v1/questions/banks?limit=100&owner=mine',
  );
  const existing = banks.items.find((bank) => bank.name === BANK_NAME);
  if (existing) return existing.id;

  const created = await call<BankRow>(
    page,
    'POST',
    '/api/v1/questions/banks',
    { name: BANK_NAME, description: 'STU-34 kartkówka fixture' },
    201,
  );
  return created.id;
}

/** A mcq question with one correct and one wrong option (1 point when graded). */
async function createQuestion(page: Page, bankId: string, content: string): Promise<string> {
  const created = await call<QuestionRow>(
    page,
    'POST',
    '/api/v1/questions',
    {
      bankId,
      type: 'mcq',
      content,
      answers: [
        { content: 'Odpowiedź poprawna', isCorrect: true, orderIndex: 0 },
        { content: 'Odpowiedź błędna', isCorrect: false, orderIndex: 1 },
      ],
    },
    201,
  );
  return created.id;
}

interface AssignmentParams {
  title: string;
  questionIds: string[];
  deadline: string;
  maxAttempts: number;
  timeLimitMin?: number;
  groupIds?: string[];
  studentIds?: string[];
  publish: boolean;
}

/** Create the assignment with its questions and targets, optionally publishing it. */
async function createAssignment(page: Page, params: AssignmentParams): Promise<AssignmentDetail> {
  const created = await call<AssignmentDetail>(
    page,
    'POST',
    '/api/v1/teacher/assignments',
    {
      title: params.title,
      description: `STU-34 ${params.title}`,
      deadline: params.deadline,
      maxAttempts: params.maxAttempts,
      ...(params.timeLimitMin ? { timeLimitMin: params.timeLimitMin } : {}),
      showResults: true,
      shuffleQuestions: false,
      shuffleAnswers: false,
    },
    201,
  );

  const added = await call<{ added: number }>(
    page,
    'POST',
    `/api/v1/teacher/assignments/${created.id}/questions`,
    { questionIds: params.questionIds },
  );
  expect(added.added, `${params.title} holds its questions`).toBe(params.questionIds.length);

  await call<null>(
    page,
    'PUT',
    `/api/v1/teacher/assignments/${created.id}/targets`,
    params.groupIds ? { groupIds: params.groupIds } : { studentIds: params.studentIds },
  );

  const detail = await call<AssignmentDetail>(
    page,
    'GET',
    `/api/v1/teacher/assignments/${created.id}`,
  );
  expect(detail.question_count, `${params.title} question count`).toBe(params.questionIds.length);
  expect(detail.total_points, `${params.title} points (one per question)`).toBe(
    params.questionIds.length,
  );

  if (params.publish) {
    const published = await call<AssignmentDetail>(
      page,
      'POST',
      `/api/v1/teacher/assignments/${created.id}/publish`,
      {},
    );
    expect(published.status, `${params.title} is published`).toBe('published');
  }

  return detail;
}

/** The student starts an attempt on the assignment and receives its questions. */
async function startAttempt(page: Page, assignmentId: string): Promise<StartedAttempt> {
  return call<StartedAttempt>(page, 'POST', `/api/v1/assignments/${assignmentId}/start`, {});
}

/**
 * Answer every question of the attempt (the first served option), returning the score.
 * `shuffleAnswers` is off for this fixture, but picking by content keeps it independent
 * of option order: the first option of every question is the correct one.
 */
async function submitAttempt(
  page: Page,
  attempt: StartedAttempt,
): Promise<{ score: number; totalQuestions: number }> {
  const answers = attempt.questions.map((question) => ({
    questionId: question.id,
    selectedAnswerId: question.question_answers[0].id,
  }));
  return call<{ score: number; totalQuestions: number }>(
    page,
    'POST',
    `/api/v1/quiz/${attempt.id}`,
    { answers },
  );
}

test.describe('@case:STU-34 @area:STU @prio:P2 student quiz list', () => {
  test('lists pending, in-progress and completed kartkówki, scoped to the student’s groups', async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(180_000);

    const tenant: QaTenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    expect(tenant.org, 'the tenant has an organization').toBeTruthy();
    expect(tenant.group, 'the tenant has the default group').toBeTruthy();
    expect(tenant.users.teacher, 'the tenant seeds the teacher').toBeTruthy();
    expect(tenant.users.manager, 'the tenant seeds the manager').toBeTruthy();
    expect(tenant.users.student, 'the tenant seeds the student').toBeTruthy();
    const studentId = tenant.users.student!.id;

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // ── Teacher: a clean tenant, then the case's published kartkówki ─────────
    const teacherContext = await browser.newContext({ baseURL });
    try {
      const teacherPage = await teacherContext.newPage();
      const teacherErrors: string[] = [];
      teacherPage.on('pageerror', (error) => teacherErrors.push(error.message));

      // The second group needs `group.manage`, which only the org admin has here.
      await loginAs(teacherPage, tenant, 'manager', { locale: 'pl', waitFor: /\/manage/ });
      const outsiderGroupId = await ensureOutsiderGroup(teacherPage);

      await loginAs(teacherPage, tenant, 'teacher', { locale: 'pl', waitFor: /\/edu/ });
      await clearAssignments(teacherPage);

      const bankId = await ensureBank(teacherPage);
      const firstQuestion = await createQuestion(teacherPage, bankId, 'STU-34 pytanie 1');
      const secondQuestion = await createQuestion(teacherPage, bankId, 'STU-34 pytanie 2');
      const thirdQuestion = await createQuestion(teacherPage, bankId, 'STU-34 pytanie 3');

      const groupDeadline = new Date(Date.now() + 3 * DAY_MS).toISOString();
      const individualDeadline = new Date(Date.now() + 5 * DAY_MS).toISOString();
      const outsiderDeadline = new Date(Date.now() + 6 * DAY_MS).toISOString();

      // ── Step 1: the empty state, before any kartkówka is published ────────
      await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app$/ });
      await page.goto('/app/assignments');
      await expect(page).toHaveURL(/\/app\/assignments$/);
      await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
      await expect(
        content(page).getByRole('heading', { level: 1, name: COPY.title, exact: true }),
      ).toBeVisible();
      await expect(content(page).getByText(COPY.empty, { exact: true })).toBeVisible();
      await expect(content(page).getByText(COPY.emptyDescription, { exact: true })).toBeVisible();
      await expect(
        content(page).getByRole('heading', { level: 2, name: /^./ }),
        'no section is rendered in the empty state',
      ).toHaveCount(0);

      const group = await createAssignment(teacherPage, {
        title: TITLE_GROUP,
        questionIds: [firstQuestion, secondQuestion],
        deadline: groupDeadline,
        maxAttempts: 1,
        timeLimitMin: 10,
        groupIds: [tenant.group!.id],
        publish: true,
      });
      const individual = await createAssignment(teacherPage, {
        title: TITLE_INDIVIDUAL,
        questionIds: [thirdQuestion],
        deadline: individualDeadline,
        maxAttempts: 2,
        studentIds: [studentId],
        publish: true,
      });
      const outsider = await createAssignment(teacherPage, {
        title: TITLE_OUTSIDER,
        questionIds: [firstQuestion],
        deadline: outsiderDeadline,
        maxAttempts: 1,
        groupIds: [outsiderGroupId],
        publish: true,
      });
      const draft = await createAssignment(teacherPage, {
        title: TITLE_DRAFT,
        questionIds: [secondQuestion],
        deadline: outsiderDeadline,
        maxAttempts: 1,
        groupIds: [tenant.group!.id],
        publish: false,
      });

      // ── Step 2: „Oczekujące (N)” with the case's card data ────────────────
      await page.reload();
      const pending = section(page, /^Oczekujące \(2\)$/i);
      await expect(pending, 'both targeted quizzes are pending').toBeVisible();
      await expect(pending.locator('a')).toHaveCount(2);

      const groupCard = assignmentCard(page, group.id);
      await expect(groupCard).toBeVisible();
      await expect(groupCard).toContainText(TITLE_GROUP);
      await expect(
        groupCard.getByText('2 pytania · 2 punkty', { exact: true }),
        'question count and points badge',
      ).toBeVisible();
      await expect(groupCard).toContainText(`Termin: ${await datePl(page, groupDeadline)}`);
      await expect(groupCard, 'the time limit from the assignment').toContainText('10 min');

      const individualCard = assignmentCard(page, individual.id);
      await expect(individualCard).toBeVisible();
      await expect(
        individualCard.getByText('1 pytanie · 1 punkt', { exact: true }),
        'Polish singular for 1 question / 1 point',
      ).toBeVisible();
      await expect(individualCard).toContainText(
        `Termin: ${await datePl(page, individualDeadline)}`,
      );
      await expect(individualCard).toContainText('Pozostało prób: 2/2');

      await expect(section(page, COPY.inProgress), 'nothing is in progress yet').toHaveCount(0);
      await expect(section(page, COPY.completed), 'nothing is completed yet').toHaveCount(0);

      // ── Isolation: the draft and the other group's quiz stay invisible ────
      for (const hidden of [outsider.id, draft.id]) {
        await expect(assignmentCard(page, hidden), `${hidden} must not be listed`).toHaveCount(0);
      }
      await expect(page.getByText(TITLE_OUTSIDER)).toHaveCount(0);
      await expect(page.getByText(TITLE_DRAFT)).toHaveCount(0);

      const studentList = await call<StudentAssignmentRow[]>(page, 'GET', '/api/v1/assignments');
      expect(
        studentList.map((row) => row.id).sort(),
        'the student API returns only the group- and student-targeted quizzes',
      ).toEqual([group.id, individual.id].sort());

      // ── Step 3: a started attempt has its own „W trakcie” section ─────────
      const started = await startAttempt(page, individual.id);
      expect(started.questions.length, 'the open attempt serves its question').toBe(1);

      await page.reload();
      await expect(
        section(page, /^Oczekujące \(1\)$/i),
        'the started quiz leaves pending',
      ).toBeVisible();
      const inProgress = section(page, COPY.inProgress);
      await expect(inProgress).toBeVisible();
      await expect(assignmentCard(page, individual.id)).toHaveCount(1);
      await expect(inProgress.locator('a'), 'only the started quiz is in progress').toHaveCount(1);
      await expect(assignmentCard(page, individual.id)).toContainText('1 pytanie · 1 punkt');
      await expect(section(page, COPY.completed)).toHaveCount(0);

      // ── Step 4: a used-up quiz moves to „Ukończone (N)” ───────────────────
      const finished = await startAttempt(page, group.id);
      expect(finished.questions.length, 'the group quiz serves both questions').toBe(2);
      const submitted = await submitAttempt(page, finished);
      expect(submitted.totalQuestions, 'both questions are graded').toBe(2);

      await page.reload();
      await expect(section(page, COPY.pending), 'nothing is pending any more').toHaveCount(0);

      const completed = section(page, /^Ukończone \(1\)$/i);
      await expect(completed).toBeVisible();
      await expect(completed.locator('a')).toHaveCount(1);

      const completedCard = assignmentCard(page, group.id);
      await expect(completedCard).toContainText(TITLE_GROUP);
      await expect(
        completedCard,
        'the completed card shows the score out of the quiz points',
      ).toContainText(`${submitted.score}/${group.total_points}`);
      await expect(completedCard).toContainText(
        `Ukończono: ${await datePl(page, new Date().toISOString())}`,
      );

      await expect(inProgress, 'the unfinished attempt stays in „W trakcie”').toBeVisible();
      await expect(inProgress.locator('a')).toHaveCount(1);
      await expect(assignmentCard(page, individual.id)).toHaveCount(1);

      // The hidden quizzes are still absent after the state changes.
      for (const hidden of [outsider.id, draft.id]) {
        await expect(assignmentCard(page, hidden), `${hidden} must not be listed`).toHaveCount(0);
      }

      expect(teacherErrors, 'uncaught page errors in the teacher session').toEqual([]);
    } finally {
      await teacherContext.close();
    }

    expect(pageErrors, 'uncaught page errors in the student session').toEqual([]);
  });
});
