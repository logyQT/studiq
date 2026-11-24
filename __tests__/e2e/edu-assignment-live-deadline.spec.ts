import { expect, type Page, test } from '@playwright/test';
import { t } from '#test/e2e/utils';
import { dbToDatetimeLocal } from '@/lib/datetime';
import { json } from '#test/helpers/json';

/**
 * Regression spec for #1191 — a live run's deadline was a back door to the close: setting it to the
 * past ended the reservation immediately (and, from slice 3, revealed the key), without the record,
 * the expired attempts or the deliberate action that Close provides.
 *
 * The spec drives the edit form the teacher actually sees: the guidance appears as soon as the field
 * holds a past instant, the save is refused with the field error, the item stays sealed — and the
 * future shrink that is a normal correction still saves, still sealed. Close is the path that ends it.
 */

const PASSWORD = 'pass';
const TEACHER_EMAIL = 'teacher-classroom@dev.local';
const STUDENT_EMAIL = 'student-classroom@dev.local';
const STUDENT_ID = '00000000-0000-4000-8001-00000000000B';

function inHours(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

async function login(page: Page, email: string, redirectPattern: RegExp) {
  await page.goto('/login');
  await page.getByLabel(t('LoginPage.email_label')).fill(email);
  await page.getByLabel(t('LoginPage.password_label')).fill(PASSWORD);
  await page.getByRole('button', { name: t('LoginPage.login_button') }).click();
  // The landing chain (document → /dashboard → orgs/permissions → area) outlives
  // Playwright's 6 s default.
  await page.waitForURL(redirectPattern, { timeout: 15_000 });

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
  await page.waitForURL(redirectPattern, { timeout: 15_000 });
}

test.describe('a live assessment deadline may move, but not end the run (#1191)', () => {
  test('the field refuses a past close, a future shrink saves, and Close ends the run', async ({
    page,
    browser,
    baseURL,
  }) => {
    let assignmentId: string | null = null;
    const studentContext = await browser.newContext({ baseURL });

    try {
      await login(page, TEACHER_EMAIL, /\/edu/);

      const questionsRes = await page.request.get('/api/v1/questions');
      expect(questionsRes.ok()).toBeTruthy();
      const { data: questions } = await json<{ data?: Array<{ id: string }> }>(questionsRes);
      const questionId = questions?.[0]?.id;
      if (!questionId) throw new Error('The Classroom seed must contain a question');

      const createRes = await page.request.post('/api/v1/teacher/assignments', {
        data: { title: `E2E live deadline #1191 ${Date.now()}`, showResults: true },
      });
      expect(createRes.ok()).toBeTruthy();
      assignmentId = (await json<{ data: { id: string } }>(createRes)).data.id;

      expect(
        (
          await page.request.post(`/api/v1/teacher/assignments/${assignmentId}/questions`, {
            data: { questionIds: [questionId] },
          })
        ).ok(),
      ).toBeTruthy();
      expect(
        (
          await page.request.put(`/api/v1/teacher/assignments/${assignmentId}/targets`, {
            data: { studentIds: [STUDENT_ID] },
          })
        ).ok(),
      ).toBeTruthy();
      // A start two hours back is what makes the run live, and it leaves room for a past deadline
      // that is still after the start — the case the live rule decides, not the window rule.
      const published = await page.request.post(
        `/api/v1/teacher/assignments/${assignmentId}/publish`,
        { data: { deadline: inHours(48), startTime: inHours(-2) } },
      );
      expect(published.ok(), `publish -> ${published.status()}`).toBeTruthy();

      const studentPage = await studentContext.newPage();
      await login(studentPage, STUDENT_EMAIL, /\/app/);
      /** The sealed item's student read: 404 while held, 200 once the run releases it. */
      const sealed = async () =>
        (await studentPage.request.get(`/api/v1/questions/${questionId}`)).status();
      expect(await sealed(), 'the item is held while the window is open').toBe(404);

      await page.goto(`/edu/assignments/${assignmentId}/edit`);
      const deadline = page.getByLabel(t('EduAssignmentForm.deadline'));
      const guidance = page.getByText(t('Errors.VALIDATION_DEADLINE_END_IS_CLOSE'));
      const closeNow = page.getByRole('button', { name: t('EduAssignmentForm.close_now') });

      // The form states the rule before the save: a past instant on a live run is a close.
      await deadline.fill(dbToDatetimeLocal(inHours(-1)));
      await expect(guidance).toBeVisible();
      await expect(closeNow).toBeVisible();

      const refused = page.waitForResponse(
        (res) =>
          res.request().method() === 'PUT' &&
          new URL(res.url()).pathname === `/api/v1/teacher/assignments/${assignmentId}`,
      );
      await page.getByRole('button', { name: t('EduAssignmentForm.save_changes') }).click();
      const refusedResponse = await refused;
      expect(refusedResponse.status()).toBe(422);
      expect(refusedResponse.headers()['x-error-code']).toBe('UNPROCESSABLE_ENTITY');
      test.info().annotations.push({
        type: 'trace-id',
        description: refusedResponse.headers()['x-trace-id'] ?? 'missing',
      });
      await expect(guidance).toBeVisible();
      expect(await sealed(), 'the refused edit leaves the item sealed').toBe(404);

      const row = await json<{ data: { deadline: string; closed_at: string | null } }>(
        await page.request.get(`/api/v1/teacher/assignments/${assignmentId}`),
      );
      expect(row.data.closed_at, 'a clock edit is not a close').toBeNull();

      // A shrink to a future instant is a normal correction: it saves, and the seal still covers the
      // class until it.
      const saved = page.waitForResponse(
        (res) =>
          res.request().method() === 'PUT' &&
          new URL(res.url()).pathname === `/api/v1/teacher/assignments/${assignmentId}`,
      );
      await deadline.fill(dbToDatetimeLocal(inHours(2)));
      await expect(guidance).toHaveCount(0);
      await page.getByRole('button', { name: t('EduAssignmentForm.save_changes') }).click();
      expect((await saved).status()).toBe(200);
      await page.waitForURL(new RegExp(`/edu/assignments/${assignmentId}$`, 'i'));
      expect(await sealed(), 'the seal still covers the class').toBe(404);

      // Ending the run now is the Close action, and only that: it records the close and reveals.
      await page.getByRole('button', { name: t('EduAssignmentDetailPage.close') }).click();
      const dialog = page.getByRole('alertdialog');
      await expect(dialog).toBeVisible();
      const closed = page.waitForResponse(
        (res) =>
          res.request().method() === 'POST' &&
          new URL(res.url()).pathname === `/api/v1/teacher/assignments/${assignmentId}/close`,
      );
      await dialog.getByRole('button', { name: t('EduAssignmentDetailPage.close') }).click();
      expect((await closed).status()).toBe(200);
      expect(await sealed(), 'the close releases the item').toBe(200);
    } finally {
      if (assignmentId) {
        await page.request
          .delete(`/api/v1/teacher/assignments/${assignmentId}`)
          .catch(() => undefined);
      }
      await studentContext.close();
    }
  });
});
