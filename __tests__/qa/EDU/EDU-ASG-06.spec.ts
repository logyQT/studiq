import { expect, test, type Page } from '@playwright/test';
import { loadTenant, loginAs } from '@qa/fixtures/qa-tenant';

/**
 * EDU-ASG-06 — deleting a draft assignment („kartkówka”).
 *
 * Case steps: open the draft's „Usuń” action, first cancel the confirmation
 * dialog, then confirm it. Expected result: the dialog reads „Usunąć tę
 * kartkówkę? Tej operacji nie można cofnąć.”; confirming removes the assignment
 * from the list, cancelling deletes nothing.
 *
 * Tenant (deterministic, `content` profile, fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts EDU-ASG-06 --fresh
 *
 * gives the org `qa-edu-asg-06-<suffix>` with a manager, an educator and a
 * student, plus the default group `G1`
 * (`tenantKey('qa/cases/EDU-ASG-06.md', 'EDU-ASG-06#<suffix>', 'qa-shared')` +
 * `tenantId` for every id). The case's legacy account (`teacher-classroom@dev.local`)
 * is never used. Nothing global is read or written: no admin setting, feature
 * flag, plan, platform stat or singleton row.
 *
 * The case's prerequisite („Szkic kartkówki”) is built by the spec itself through
 * the same API the create form calls: two drafts, so the test can prove that
 * deleting one leaves the other untouched. Every assertion follows the ids
 * returned by those calls, so a re-run on the same tenant (CI seeds once and
 * retries against it) only adds drafts the assertions do not depend on.
 *
 * Acceptance points (confirmed on the shared app during the walk):
 * 1. The draft detail page offers „Usuń”; activating it opens the alert dialog
 *    „Usunąć tę kartkówkę?” / „Tej operacji nie można cofnąć.” with „Anuluj” and
 *    „Usuń”.
 * 2. „Anuluj” closes the dialog and keeps the draft: the detail page still renders
 *    it and the list API still returns it.
 * 3. Confirming „Usuń” returns to `/edu/assignments`, where the deleted draft is
 *    gone (list card and API), while the other draft is still there and still
 *    readable through `GET /api/v1/teacher/assignments/<id>`.
 */

const CASE = 'EDU-ASG-06';

/** Polish copy from `EduAssignmentDetailPage` / `EduAssignmentsPage` (pl.json). */
const COPY = {
  listTitle: 'Kartkówki',
  draft: 'Szkic',
  delete: 'Usuń',
  cancel: 'Anuluj',
  dialogTitle: 'Usunąć tę kartkówkę?',
  dialogDescription: 'Tej operacji nie można cofnąć.',
} as const;

const DRAFTS = {
  /** The assignment the case deletes. */
  target: 'Kartkówka do usunięcia',
  /** Control draft: deleting the target must not touch it. */
  control: 'Kartkówka kontrolna',
} as const;

const ASSIGNMENTS_URL = '/api/v1/teacher/assignments';

/** Creates a draft assignment through the teacher API and returns its id. */
async function createDraft(page: Page, title: string): Promise<string> {
  const response = await page.request.post(ASSIGNMENTS_URL, { data: { title } });
  expect(response.status(), `POST ${ASSIGNMENTS_URL} (${title})`).toBe(201);
  const body = (await response.json()) as { data: { id: string; status: string } };
  expect(body.data.status, `a freshly created assignment is a draft (${title})`).toBe('draft');
  return body.data.id;
}

/** The list/detail render a card per assignment, linked to its own id. */
function assignmentCard(page: Page, id: string) {
  return page.locator(`a[href="/edu/assignments/${id}"]`);
}

test.describe('@case:EDU-ASG-06 @area:EDU @prio:P2 delete a draft assignment', () => {
  test('cancelling keeps the draft and confirming deletes only that assignment', async ({
    page,
  }) => {
    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    const educator = tenant.users.teacher;
    if (!tenant.org || !educator) {
      throw new Error(`${CASE} needs the content tenant profile (org and educator)`);
    }

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await loginAs(page, tenant, 'teacher', { locale: 'pl', waitFor: /\/edu(\/|$)/ });
    expect(new URL(page.url()).pathname, 'the educator lands on /edu').toBe('/edu');

    // --- Prerequisite: a draft assignment (plus one control draft) ----------
    const targetId = await createDraft(page, DRAFTS.target);
    const controlId = await createDraft(page, DRAFTS.control);

    await page.goto('/edu/assignments');
    await expect(page).toHaveURL(/\/edu\/assignments$/);
    await expect(page.locator('h1')).toHaveText(COPY.listTitle);
    await expect(assignmentCard(page, targetId)).toContainText(DRAFTS.target);
    await expect(
      assignmentCard(page, targetId).getByText(COPY.draft, { exact: true }),
    ).toBeVisible();

    // --- Step 1: the draft's „Usuń” opens the confirmation dialog ----------
    await page.goto(`/edu/assignments/${targetId}`);
    await expect(page.locator('h1')).toHaveText(DRAFTS.target);
    await expect(page.getByText(COPY.draft, { exact: true })).toBeVisible();

    await page.getByRole('button', { name: COPY.delete, exact: true }).click();

    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(COPY.dialogTitle, { exact: true })).toBeVisible();
    await expect(dialog.getByText(COPY.dialogDescription, { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: COPY.cancel, exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: COPY.delete, exact: true })).toBeVisible();

    // --- Step 2a: cancelling deletes nothing --------------------------------
    await dialog.getByRole('button', { name: COPY.cancel, exact: true }).click();
    await expect(dialog, '„Anuluj” closes the confirmation dialog').toBeHidden();

    // Still on the draft, still rendering it.
    await expect(page).toHaveURL(new RegExp(`/edu/assignments/${targetId}$`));
    await expect(page.locator('h1')).toHaveText(DRAFTS.target);

    const afterCancel = await page.request.get(`${ASSIGNMENTS_URL}/${targetId}`);
    expect(afterCancel.status(), 'the cancelled draft still exists').toBe(200);
    await page.goto('/edu/assignments');
    await expect(
      assignmentCard(page, targetId),
      'the cancelled draft stays on the list',
    ).toBeVisible();

    // --- Step 2b: confirming deletes the draft ------------------------------
    await page.goto(`/edu/assignments/${targetId}`);
    await expect(page.locator('h1')).toHaveText(DRAFTS.target);
    await page.getByRole('button', { name: COPY.delete, exact: true }).click();
    const confirmDialog = page.getByRole('alertdialog');
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole('button', { name: COPY.delete, exact: true }).click();

    // Expected result: the assignment disappears from the list.
    await expect(page).toHaveURL(/\/edu\/assignments$/);
    await expect(page.locator('h1')).toHaveText(COPY.listTitle);
    await expect(
      assignmentCard(page, targetId),
      'the deleted draft is gone from the assignments list',
    ).toBeHidden();

    const deleted = await page.request.get(`${ASSIGNMENTS_URL}/${targetId}`);
    expect(deleted.status(), 'GET the deleted draft').toBe(404);
    const list = (await (await page.request.get(ASSIGNMENTS_URL)).json()) as {
      data: Array<{ id: string }>;
    };
    const ids = list.data.map((assignment) => assignment.id);
    expect(ids, 'the deleted draft is not served any more').not.toContain(targetId);

    // --- Adjacent regression: only the confirmed draft is deleted -----------
    await expect(assignmentCard(page, controlId), 'the other draft is untouched').toBeVisible();
    await expect(assignmentCard(page, controlId)).toContainText(DRAFTS.control);
    const survivor = await page.request.get(`${ASSIGNMENTS_URL}/${controlId}`);
    expect(survivor.status(), 'the other draft is still readable').toBe(200);
    expect(ids, 'the other draft is still listed').toContain(controlId);

    expect(pageErrors, 'uncaught page errors during the walk').toEqual([]);
  });
});
