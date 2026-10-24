import { expect, type Page, test } from '@playwright/test';
import { t } from '#test/e2e/utils';

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

async function login(page: Page, email: string, redirectPattern: RegExp) {
  await page.goto('/login');
  await page.getByLabel(t('LoginPage.email_label')).fill(email);
  await page.getByLabel(t('LoginPage.password_label')).fill(PASSWORD);
  await page.getByRole('button', { name: t('LoginPage.login_button') }).click();
  await page.waitForURL(redirectPattern);

  // Login does not set the active-org cookie; the app pins it right after the
  // redirect (`useOrgs`, both seeded accounts only belong to Classroom). Wait
  // for that to settle — otherwise the org-scoped API calls below run without
  // a cookie and the redirect back to the dashboard lands mid-test.
  await expect
    .poll(
      async () => {
        const res = await page.request.get('/api/v1/me/orgs');
        if (!res.ok()) return false;
        const { data } = (await res.json()) as { data?: Array<{ isActive: boolean }> };
        return (data ?? []).some((org) => org.isActive);
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  await page.waitForURL(redirectPattern);
  await page.waitForLoadState('networkidle');
}

test.describe('teacher assignment grading refreshes the results table (#168)', () => {
  test('navigating back after grading shows the graded row without a reload', async ({
    page,
    browser,
    baseURL,
  }) => {
    let createdAssignmentId: string | null = null;
    const studentContext = await browser.newContext({ baseURL });

    try {
      // ── Provision: one open question, targeted at SC and published ──────
      await login(page, TEACHER_EMAIL, /\/edu/);

      const questionsRes = await page.request.get('/api/v1/questions');
      expect(questionsRes.ok()).toBeTruthy();
      const questions = ((await questionsRes.json()).data ?? []) as Array<{
        id: string;
        type: string;
      }>;
      const openQuestion = questions.find((question) => question.type === 'open');
      if (!openQuestion) {
        throw new Error('The Classroom seed must contain an open question');
      }

      const createRes = await page.request.post('/api/v1/teacher/assignments', {
        data: { title: `E2E grading results #168 ${Date.now()}` },
      });
      expect(createRes.ok()).toBeTruthy();
      const assignmentId = (await createRes.json()).data.id as string;
      createdAssignmentId = assignmentId;

      const addRes = await page.request.post(
        `/api/v1/teacher/assignments/${assignmentId}/questions`,
        { data: { questionIds: [openQuestion.id] } },
      );
      expect(addRes.ok()).toBeTruthy();

      const targetsRes = await page.request.put(
        `/api/v1/teacher/assignments/${assignmentId}/targets`,
        { data: { studentIds: [STUDENT_ID] } },
      );
      expect(targetsRes.ok()).toBeTruthy();

      const publishRes = await page.request.post(
        `/api/v1/teacher/assignments/${assignmentId}/publish`,
        { data: {} },
      );
      expect(publishRes.ok()).toBeTruthy();

      // ── The student submits a text answer ───────────────────────────────
      const studentPage = await studentContext.newPage();
      await login(studentPage, STUDENT_EMAIL, /\/app/);

      const startRes = await studentPage.request.post(`/api/v1/assignments/${assignmentId}/start`);
      expect(startRes.ok()).toBeTruthy();
      const attemptId = (await startRes.json()).data.id as string;
      const answers = [{ questionId: openQuestion.id, textAnswer: 'E2E answer for #168' }];

      const submitRes = await studentPage.request.post(`/api/v1/quiz/${attemptId}`, {
        data: { attemptId, answers },
      });
      expect(submitRes.ok(), `submit attempt -> ${submitRes.status()}`).toBeTruthy();

      // ── Grade through the UI, then navigate back in-app ─────────────────
      await page.goto(`/edu/assignments/${assignmentId}/results`);
      const row = page.locator('tbody tr', { hasText: 'Classroom Student' });
      await expect(row.getByText(t('EduAssignmentResultsPage.submitted'))).toBeVisible();

      await row.getByRole('link', { name: t('EduAssignmentResultsPage.grade') }).click();
      await page.waitForURL(new RegExp(`/results/${STUDENT_ID}$`, 'i'));

      // `POST …/questions` does not take points, so `assignment_questions.points`
      // stays at the schema default 1 (#169 rejects anything above it).
      await page.locator('input[type="number"]').first().fill('1');

      const saveGrade = page.waitForResponse(
        (res) =>
          res.request().method() === 'PUT' &&
          res.url().toLowerCase().includes(`/results/${STUDENT_ID}`.toLowerCase()),
      );
      await page.getByRole('button', { name: t('EduGradingPage.save') }).click();
      expect((await saveGrade).status()).toBe(200);

      // Arm the list refetch *before* the click: the whole point of #168 is
      // that this GET is issued on the SPA navigation back.
      const resultsRefetch = page.waitForResponse((res) => {
        const url = new URL(res.url());
        return (
          res.request().method() === 'GET' &&
          url.pathname === `/api/v1/teacher/assignments/${assignmentId}/results`
        );
      });
      await page.getByRole('link', { name: t('EduGradingPage.back') }).click();
      expect((await resultsRefetch).status()).toBe(200);

      await expect(row.getByText(t('EduAssignmentResultsPage.graded'))).toBeVisible();
      await expect(row.getByText(t('EduAssignmentResultsPage.submitted'))).toHaveCount(0);
      // Status alone is not enough: a stale score with a fresh status must fail too.
      await expect(row.locator('td').nth(2)).toHaveText('1/1');
    } finally {
      if (createdAssignmentId) {
        await page.request
          .delete(`/api/v1/teacher/assignments/${createdAssignmentId}`)
          .catch(() => undefined);
      }
      await studentContext.close();
    }
  });
});
