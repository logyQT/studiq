import { expect, type Page, test } from '@playwright/test';
import { t, waitForDashboardArea } from '#test/e2e/utils';
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

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel(t('LoginPage.email_label')).fill(email);
  await page.getByLabel(t('LoginPage.password_label')).fill(PASSWORD);
  await page.getByRole('button', { name: t('LoginPage.login_button') }).click();
  await waitForDashboardArea(page);

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
 * A run that opened two hours ago, built through the API the way the Classroom teacher would. A
 * start two hours back is what makes the run live, and it leaves room for a past deadline that is
 * still after the start: the case the live rule decides, not the window rule. `onCreated` reports
 * the id as soon as it exists, so the caller can clean up even when a later step fails.
 */
async function publishLiveRun(
  page: Page,
  title: string,
  onCreated: (assignmentId: string) => void,
): Promise<{ assignmentId: string; questionId: string }> {
  const questionsRes = await page.request.get('/api/v1/questions');
  expect(questionsRes.ok()).toBeTruthy();
  const { data: questions } = await json<{ data?: Array<{ id: string }> }>(questionsRes);
  const questionId = questions?.[0]?.id;
  if (!questionId) throw new Error('The Classroom seed must contain a question');

  const createRes = await page.request.post('/api/v1/teacher/assignments', {
    data: { title, showResults: true },
  });
  expect(createRes.ok()).toBeTruthy();
  const assignmentId = (await json<{ data: { id: string } }>(createRes)).data.id;
  onCreated(assignmentId);

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
  const published = await page.request.post(`/api/v1/teacher/assignments/${assignmentId}/publish`, {
    data: { deadline: inHours(48), startTime: inHours(-2) },
  });
  expect(published.ok(), `publish -> ${published.status()}`).toBeTruthy();
  return { assignmentId, questionId };
}

test.describe('a live assessment deadline may move, but not end the run (#1191)', () => {
  test('the field refuses a past close, a future shrink saves, and Close ends the run', async ({
    page,
    browser,
    baseURL,
  }) => {
    const created: { id: string | null } = { id: null };
    const studentContext = await browser.newContext({ baseURL });

    try {
      await login(page, TEACHER_EMAIL);

      const run = await publishLiveRun(page, `E2E live deadline #1191 ${Date.now()}`, (id) => {
        created.id = id;
      });
      const { assignmentId, questionId } = run;

      const studentPage = await studentContext.newPage();
      await login(studentPage, STUDENT_EMAIL);
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
      if (created.id) {
        await page.request
          .delete(`/api/v1/teacher/assignments/${created.id}`)
          .catch(() => undefined);
      }
      await studentContext.close();
    }
  });

  test('the sampling rules are frozen on a live run, and the rest still saves (#1300)', async ({
    page,
  }) => {
    const created: { id: string | null } = { id: null };
    try {
      await login(page, TEACHER_EMAIL, /\/edu/);
      const run = await publishLiveRun(page, `E2E frozen sampling #1300 ${Date.now()}`, (id) => {
        created.id = id;
      });

      await page.goto(`/edu/assignments/${run.assignmentId}/edit`);
      // No control that always refuses: the three frozen rules are disabled and say why.
      await expect(page.getByLabel(t('EduAssignmentForm.attempt_item_count'))).toBeDisabled();
      await expect(
        page.getByRole('switch', { name: t('EduAssignmentForm.same_item_retake') }),
      ).toBeDisabled();
      await expect(
        page.getByRole('switch', { name: t('EduAssignmentForm.unseen_only') }),
      ).toBeDisabled();
      await expect(
        page.getByText(t('EduAssignmentForm.sampling_frozen_started')).first(),
      ).toBeVisible();

      // The form re-sends the stored sampling values on every save; that is not a change.
      const saved = page.waitForResponse(
        (res) =>
          res.request().method() === 'PUT' &&
          new URL(res.url()).pathname === `/api/v1/teacher/assignments/${run.assignmentId}`,
      );
      await page.getByLabel(t('EduAssignmentForm.title_field')).fill(`Renamed #1300 ${Date.now()}`);
      await page.getByRole('button', { name: t('EduAssignmentForm.save_changes') }).click();
      expect((await saved).status()).toBe(200);

      // The server holds the rule on its own: a change to a frozen field is refused.
      const refused = await page.request.put(`/api/v1/teacher/assignments/${run.assignmentId}`, {
        data: { attemptItemCount: 5 },
      });
      expect(refused.status()).toBe(409);
      expect(refused.headers()['x-error-code']).toBe('ASSESSMENT_LIVE');
    } finally {
      if (created.id) {
        await page.request
          .delete(`/api/v1/teacher/assignments/${created.id}`)
          .catch(() => undefined);
      }
    }
  });
});
