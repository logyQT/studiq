import { expect, type Page, test } from '@playwright/test';
import { t, waitForDashboardArea } from '#test/e2e/utils';
import { json } from '#test/helpers/json';

/** The publish gate requires a close (R2/R5): a published run must be able to end. */
const PUBLISH_DEADLINE = new Date(Date.now() + 7 * 86_400_000).toISOString();

/**
 * Regression spec for #168 — the results table kept the cached `Przesłane` row
 * after grading until a full reload.
 *
 * The assertion that would have failed before the fix is the awaited
 * `GET …/teacher/assignments/{id}/results` when navigating back: the stale cache
 * never issued that request, so `waitForResponse` timed out. (`useApiQuery`
 * defaults to `staleTime: Infinity`, so only an invalidation of the results
 * *list* key makes the table refetch.)
 */

const PASSWORD = 'pass';
const TEACHER_EMAIL = 'teacher-classroom@dev.local';
const STUDENT_EMAIL = 'student-classroom@dev.local';
const STUDENT_ID = '00000000-0000-4000-8001-00000000000B';

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel(t('LoginPage.email_label')).fill(email);
  await page.getByLabel(t('LoginPage.password_label')).fill(PASSWORD);
  await page.getByRole('button', { name: t('LoginPage.login_button') }).click();
  await waitForDashboardArea(page);

  // Login does not set the active-org cookie; the app pins it right after the
  // redirect (`useOrgs`, both seeded accounts only belong to Classroom). Wait
  // for that to settle — otherwise the org-scoped API calls below run without
  // a cookie and the redirect back to the dashboard lands mid-test.
  await expect
    .poll(
      async () => {
        const res = await page.request.get('/api/v1/me/orgs');
        if (!res.ok()) return false;
        const { data } = await json<{ data?: Array<{ isActive: boolean }> }>(res);
        return (data ?? []).some((org) => org.isActive);
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  await waitForDashboardArea(page);
}

/**
 * One open question, targeted at the Classroom student and published. `onCreated` gets the id
 * as soon as it exists, so a later failure can still delete the assignment.
 */
async function publishOpenAssignment(
  page: Page,
  title: string,
  onCreated: (id: string) => void,
  options: { maxAttempts?: number; allowSameItemRetake?: boolean } = {},
): Promise<{ assignmentId: string; questionId: string }> {
  const questionsRes = await page.request.get('/api/v1/questions');
  expect(questionsRes.ok()).toBeTruthy();
  const questionsBody = await json<{ data?: Array<{ id: string; type: string }> }>(questionsRes);
  const openQuestion = (questionsBody.data ?? []).find((question) => question.type === 'open');
  if (!openQuestion) {
    throw new Error('The Classroom seed must contain an open question');
  }

  const createRes = await page.request.post('/api/v1/teacher/assignments', {
    data: { title, ...options },
  });
  expect(createRes.ok()).toBeTruthy();
  const assignmentId = (await json<{ data: { id: string } }>(createRes)).data.id;
  onCreated(assignmentId);

  const addRes = await page.request.post(`/api/v1/teacher/assignments/${assignmentId}/questions`, {
    data: { questionIds: [openQuestion.id] },
  });
  expect(addRes.ok()).toBeTruthy();

  const targetsRes = await page.request.put(`/api/v1/teacher/assignments/${assignmentId}/targets`, {
    data: { studentIds: [STUDENT_ID] },
  });
  expect(targetsRes.ok()).toBeTruthy();

  const publishRes = await page.request.post(
    `/api/v1/teacher/assignments/${assignmentId}/publish`,
    { data: { deadline: PUBLISH_DEADLINE } },
  );
  expect(publishRes.ok()).toBeTruthy();

  return { assignmentId, questionId: openQuestion.id };
}

/** Starts and submits one attempt with a text answer. */
async function submitAttempt(
  page: Page,
  assignmentId: string,
  questionId: string,
  textAnswer: string,
): Promise<string> {
  const startRes = await page.request.post(`/api/v1/assignments/${assignmentId}/start`);
  expect(startRes.ok(), `start attempt -> ${startRes.status()}`).toBeTruthy();
  const attemptId = (await json<{ data: { id: string } }>(startRes)).data.id;

  const submitRes = await page.request.post(`/api/v1/quiz/${attemptId}`, {
    data: { attemptId, answers: [{ questionId, textAnswer }] },
  });
  expect(submitRes.ok(), `submit attempt -> ${submitRes.status()}`).toBeTruthy();
  return attemptId;
}

/** Gives the open item its one point on the grading page that is open. */
async function saveOnePoint(page: Page): Promise<void> {
  await page.locator('input[type="number"]').first().fill('1');
  const saved = page.waitForResponse(
    (res) =>
      res.request().method() === 'PUT' && /\/results\/[^/]+$/.test(new URL(res.url()).pathname),
  );
  await page.getByRole('button', { name: t('EduGradingPage.save') }).click();
  expect((await saved).status()).toBe(200);
}

/** The next read of one assignment's results list. */
function resultsRead(page: Page, assignmentId: string) {
  return page.waitForResponse(
    (res) =>
      res.request().method() === 'GET' &&
      new URL(res.url()).pathname === `/api/v1/teacher/assignments/${assignmentId}/results`,
  );
}

/**
 * The grading page's own key panel. The header's help button has the same name plus „(?)”, and
 * `t` matches a substring, so the whole name is anchored.
 */
const keyPanel = (page: Page) =>
  page.getByRole('button', {
    name: new RegExp(`^(?:${t('AppFlashcardSessionPage.shortcuts_panel_label').source})$`, 'i'),
  });

/** The grading page of one attempt. */
const onAttempt = (id: string | undefined) => new RegExp(`/results/${id}$`, 'i');

async function deleteAssignments(page: Page, ids: string[]): Promise<void> {
  for (const id of ids) {
    await page.request.delete(`/api/v1/teacher/assignments/${id}`).catch(() => undefined);
  }
}

test.describe('teacher assignment grading refreshes the results table (#168)', () => {
  test('navigating back after grading shows the graded row without a reload', async ({
    page,
    browser,
    baseURL,
  }) => {
    const created: string[] = [];
    const studentContext = await browser.newContext({ baseURL });

    try {
      // ── Provision: one open question, targeted at SC and published ──────
      await login(page, TEACHER_EMAIL);

      const { assignmentId, questionId } = await publishOpenAssignment(
        page,
        `E2E grading results #168 ${Date.now()}`,
        (id) => created.push(id),
      );

      // Before anyone starts, the results page names who it waits for (#1340).
      await page.goto(`/edu/assignments/${assignmentId}/results`);
      await expect(page.getByText(/Not started \(1\)|Nie rozpoczęli \(1\)/)).toBeVisible();

      // The teacher leaves the page inside the app, so the list stays in the query cache. The
      // mark on `window` is lost on a full load: it proves that none happens until the check.
      await page.evaluate(() => Reflect.set(window, 'e2eSameDocument', true));
      await page.getByRole('link', { name: t('EduAssignmentResultsPage.back') }).click();
      await page.waitForURL(new RegExp(`/edu/assignments/${assignmentId}$`, 'i'));

      // ── The student submits a text answer ───────────────────────────────
      const studentPage = await studentContext.newPage();
      await login(studentPage, STUDENT_EMAIL);

      const attemptId = await submitAttempt(
        studentPage,
        assignmentId,
        questionId,
        'E2E answer for #168',
      );

      // Back again, still inside the app: the page must not show the list from before.
      await page
        .getByRole('link', { name: t('EduAssignmentDetailPage.view_results'), exact: true })
        .click();
      await page.waitForURL(new RegExp(`/edu/assignments/${assignmentId}/results$`, 'i'));
      await expect(page.getByText(/Not started \(0\)|Nie rozpoczęli \(0\)/)).toBeVisible();
      expect(await page.evaluate(() => Reflect.has(window, 'e2eSameDocument'))).toBe(true);

      // ── Grade through the UI, then navigate back in-app ─────────────────
      await page.goto(`/edu/assignments/${assignmentId}/results`);
      const row = page.locator('tbody tr', { hasText: 'Classroom Student' });
      await expect(row.getByText(t('EduAssignmentResultsPage.submitted'))).toBeVisible();
      await expect(page.getByText(/Not started \(0\)|Nie rozpoczęli \(0\)/)).toBeVisible();
      // The section is collapsed, so the sentence is in the page but hidden.
      await expect(page.getByText(t('EduAssignmentResultsPage.everyone_started'))).toBeAttached();

      // The grading page reads the list when it opens (#1354). Wait for that read itself: the
      // navigation also renders from the cached list, so seeing it proves nothing. Only then
      // can the wait below get no read but the one the grade caused.
      const sheetRead = resultsRead(page, assignmentId);
      await row.getByRole('link', { name: t('EduAssignmentResultsPage.grade') }).click();
      await page.waitForURL(new RegExp(`/results/${attemptId}$`, 'i'));
      await (await sheetRead).finished();
      // One attempt: no key leads anywhere, so the page offers no key list.
      await expect(keyPanel(page)).toHaveCount(0);

      // Arm the list refetch *before* the save: the whole point of #168 is that the grade
      // makes the app read the list again. The grading page has the list open, so that read
      // starts at the save, before the navigation back.
      const resultsRefetch = resultsRead(page, assignmentId);
      // `POST …/questions` does not take points, so `assignment_questions.points`
      // stays at the schema default 1 (#169 rejects anything above it).
      await saveOnePoint(page);

      await page.getByRole('link', { name: t('EduGradingPage.back') }).click();
      expect((await resultsRefetch).status()).toBe(200);

      await expect(row.getByText(t('EduAssignmentResultsPage.graded'))).toBeVisible();
      await expect(row.getByText(t('EduAssignmentResultsPage.submitted'))).toHaveCount(0);
      // Status alone is not enough: a stale score with a fresh status must fail too.
      await expect(row.locator('td').nth(2)).toHaveText('1/1');
    } finally {
      await deleteAssignments(page, created);
      await studentContext.close();
    }
  });
});

test.describe('moving between attempts on the grading page (#1354)', () => {
  test('grades three attempts in a row without going back to the results', async ({
    page,
    browser,
    baseURL,
  }) => {
    const created: string[] = [];
    const studentContext = await browser.newContext({ baseURL });

    try {
      await login(page, TEACHER_EMAIL);
      const { assignmentId, questionId } = await publishOpenAssignment(
        page,
        `E2E grading navigation #1354 ${Date.now()}`,
        (id) => created.push(id),
        // Three to grade, and one more that arrives while the teacher grades.
        { maxAttempts: 4, allowSameItemRetake: true },
      );

      const studentPage = await studentContext.newPage();
      await login(studentPage, STUDENT_EMAIL);
      for (const answer of ['first', 'second', 'third']) {
        await submitAttempt(studentPage, assignmentId, questionId, `E2E ${answer} #1354`);
      }

      // The order of the results table.
      const resultsRes = await page.request.get(
        `/api/v1/teacher/assignments/${assignmentId}/results`,
      );
      const order = (
        await json<{ data: { attempts: Array<{ id: string }> } }>(resultsRes)
      ).data.attempts.map((attempt) => attempt.id);
      expect(order).toHaveLength(3);
      const [first, second, third] = order;

      await page.goto(`/edu/assignments/${assignmentId}/results/${first}`);
      const nav = page.getByRole('navigation', { name: t('EduGradingPage.navigation') });
      // `t` matches a substring, and „Next” is part of „Next ungraded”: anchor the whole name.
      const link = (key: string) =>
        nav.getByRole('link', {
          name: new RegExp(`^(?:${t(`EduGradingPage.${key}`).source})$`, 'i'),
        });
      const points = page.locator('input[type="number"]').first();
      // With other attempts to move to, the panel is there. This also shows that the locator
      // finds it, so that the count of zero on a single attempt means something.
      await expect(keyPanel(page)).toHaveCount(1);

      await saveOnePoint(page);
      await link('next_ungraded').click();
      await page.waitForURL(onAttempt(second));
      await expect(points).toHaveValue('');

      // A draft that was not saved belongs to its own attempt: every attempt has this question.
      await points.fill('1');
      await link('next_attempt').click();
      await page.waitForURL(onAttempt(third));
      await expect(points, 'the draft did not follow').toHaveValue('');

      // The keys move between attempts, but not while the teacher types.
      const feedback = page.locator('textarea').first();
      await feedback.click();
      await page.keyboard.type(']n[');
      await expect(feedback).toHaveValue(']n[');
      await expect(page).toHaveURL(onAttempt(third));
      await feedback.blur();
      await page.keyboard.press('[');
      await page.waitForURL(onAttempt(second));
      await expect(
        page.getByRole('heading', { level: 1, name: t('EduGradingPage.title') }),
        'a move puts the focus on the new sheet',
      ).toBeFocused();

      // The `?` help dialog lists the keys of this page.
      await page.keyboard.press('?');
      const help = page.getByRole('dialog');
      await expect(help.getByText(t('EduGradingPage.shortcuts_group'))).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(help).toHaveCount(0);

      await saveOnePoint(page);
      await link('next_ungraded').click();
      await page.waitForURL(onAttempt(third));
      await saveOnePoint(page);

      await expect(nav.getByText(t('EduGradingPage.all_graded'))).toBeVisible();
      await expect(link('next_ungraded')).toHaveCount(0);

      // A submission that arrives now shows on the next sheet the teacher opens, with no
      // reload and no saved grade in between.
      const late = await submitAttempt(studentPage, assignmentId, questionId, 'E2E late #1354');
      await link('previous_attempt').click();
      await page.waitForURL(onAttempt(second));
      await expect(
        nav.getByText(/Attempt \d of 4 · 1 left to grade|Praca \d z 4 · do oceny: 1/),
      ).toBeVisible();
      await expect(nav.getByText(t('EduGradingPage.all_graded'))).toHaveCount(0);
      await link('next_ungraded').click();
      await page.waitForURL(onAttempt(late));
      await saveOnePoint(page);

      await expect(nav.getByText(t('EduGradingPage.all_graded'))).toBeVisible();
      await link('view_results').click();
      await page.waitForURL(new RegExp(`/edu/assignments/${assignmentId}/results$`, 'i'));
    } finally {
      await deleteAssignments(page, created);
      await studentContext.close();
    }
  });
});
