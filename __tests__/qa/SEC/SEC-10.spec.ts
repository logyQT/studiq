import type { Page } from '@playwright/test';
import {
  expect,
  loadTenant,
  loginAs,
  test,
  type QaRole,
  type QaTenant,
} from '@qa/fixtures/qa-tenant';

/**
 * SEC-10 — XSS w polach tekstowych.
 *
 * Case steps: create a deck named `<img src=x onerror=alert(1)>`, create a
 * flashcard whose Markdown holds `<script>alert(1)</script>` and
 * `[klik](<javascript:alert(1)>)`, put the script into a group description, a
 * question-bank name, a quiz answer and a report message, then display every
 * one of those surfaces (lists, preview, study session, teacher view).
 *
 * Expected result: the payloads are shown as text, no script executes, the
 * `javascript:` link is not active and no `alert()` dialog ever opens.
 *
 * Prerequisite (reconciled with the tenant seeder): "any account allowed to
 * create content" is the `content` tenant of this case —
 * `tenantKey('qa/cases/SEC-10.md', 'SEC-10#<run>', 'qa-shared')` plus a fresh
 * run suffix, written by `bun scripts/qa-tenant.ts SEC-10 --fresh`. It gives one
 * organization, an admin (`manager`), an educator (`teacher`) and a member
 * (`student`) plus the default group `G1`. The legacy manual accounts
 * (`teacher1@dev.local`, password `pass`) are never used, and no id is
 * hard-coded: every org/user/group id comes from `qa/.tenants/SEC-10.json`.
 *
 * All content is built through the product's own API inside this tenant:
 *
 * - the manager promotes the educator to `teacher` of `G1` (sharing content with
 *   a group requires the group-teacher role) and writes the script into the
 *   group description;
 * - the educator creates the deck, its card, the question bank and the open
 *   question, then publishes an assignment to `G1`;
 * - the student answers the open question with the script and reports the
 *   question with a message holding the `img` payload.
 *
 * Observed during the walk on the shared app (3010 / DB 54421, pl), all of it
 * intended behavior:
 * 1. Names, group description, quiz answer and report message are rendered as
 *    plain text (React escaping): the payload is visible verbatim and no
 *    `<img src="x">`/`onerror` element exists.
 * 2. Card Markdown is sanitized (`rehype-sanitize`): the `<script>` element is
 *    dropped from the output entirely, the `[klik]` link renders without an
 *    `href`, so the `javascript:` URL is inert.
 * 3. No `alert()` dialog appears on any of the four surfaces.
 *
 * Nothing global is read or written: no admin setting, feature flag, plan,
 * platform stat or singleton row; only this run's own tenant rows are touched.
 */

const CASE = 'SEC-10';
const TENANT: QaTenant = loadTenant(CASE);

/** Run suffix the seeder folded into the tenant key (stable tenants have none). */
const RUN = TENANT.runSuffix ?? 'stable';

const PAYLOAD = {
  img: '<img src=x onerror=alert(1)>',
  script: '<script>alert(1)</script>',
  jsLinkMarkdown: '[klik](<javascript:alert(1)>)',
} as const;

const CARD_FRONT = `${PAYLOAD.script}\n\n${PAYLOAD.jsLinkMarkdown}`;
const GROUP_DESCRIPTION = PAYLOAD.script;
const DECK_NAME = PAYLOAD.img;
const BANK_NAME = PAYLOAD.script;
const QUESTION_CONTENT = `SEC-10 pytanie otwarte ${RUN}`;
const ASSIGNMENT_TITLE = `SEC-10 kartkówka ${RUN}`;
const REPORT_MESSAGE = PAYLOAD.img;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

function account(tenant: QaTenant, role: QaRole) {
  const user = tenant.users[role];
  if (!user) throw new Error(`tenant ${tenant.case} has no seeded ${role} user`);
  return user;
}

async function expectData<T>(
  response: { status(): number; text(): Promise<string> },
  label: string,
  expectedStatus: number,
): Promise<T> {
  expect(response.status(), `${label} → ${await response.text()}`).toBe(expectedStatus);
  const body = JSON.parse(await response.text()) as ApiEnvelope<T>;
  expect(body.success, `${label} success flag`).toBe(true);
  return body.data;
}

/**
 * Every textual surface is covered by the same contract: no executable element
 * looking like the payload is in the document. React escapes plain text and
 * `rehype-sanitize` removes the Markdown injection, so each count must be 0.
 */
async function expectNoInjection(page: Page): Promise<void> {
  const dom = await page.evaluate(() => ({
    scripts: Array.from(document.querySelectorAll('script')).filter((script) =>
      (script.textContent ?? '').includes('alert(1)'),
    ).length,
    onerrorAttributes: document.querySelectorAll('[onerror]').length,
    imgSrcX: document.querySelectorAll('img[src="x"]').length,
    javascriptHrefs: Array.from(document.querySelectorAll('a[href]')).filter((anchor) =>
      /^\s*javascript:/i.test(anchor.getAttribute('href') ?? ''),
    ).length,
  }));
  expect(dom, 'no executable payload in the rendered document').toEqual({
    scripts: 0,
    onerrorAttributes: 0,
    imgSrcX: 0,
    javascriptHrefs: 0,
  });
}

/** The case's `[klik](<javascript:alert(1)>)` must render as an inert link. */
async function expectInertKlikLink(page: Page): Promise<void> {
  // A flip card keeps its hidden side in the DOM, so only the visible link counts.
  const klik = page.locator('a').filter({ hasText: 'klik' }).filter({ visible: true });
  await expect(klik.first(), 'the Markdown link is rendered').toBeVisible();
  const href = await klik.first().getAttribute('href');
  expect(href ?? '', 'the javascript: URL is not active').not.toMatch(/^\s*javascript:/i);
}

test.describe('@case:SEC-10 @area:SEC @prio:P1 text fields resist XSS', () => {
  test('payloads render as text on lists, preview, study session and teacher views', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const orgId = TENANT.org?.id;
    const groupId = TENANT.group?.id;
    if (!orgId || !groupId) {
      throw new Error(`tenant ${CASE} needs the content profile (org + default group)`);
    }

    // A dialog is the failure the case is about; record it and let the run finish
    // so the assertion at the end names every message that would have popped.
    const dialogs: string[] = [];
    page.on('dialog', async (dialog) => {
      dialogs.push(`${dialog.type()}: ${dialog.message()}`);
      await dialog.dismiss();
    });

    console.log(`SEC-10 tenant key: ${TENANT.key}`);
    console.log(`SEC-10 org: ${orgId} (${TENANT.org?.name})`);

    // --- Prerequisite: manager makes the educator a group teacher + description -
    await loginAs(page, TENANT, 'manager', { locale: 'pl', waitFor: /\/manage(\/|$)/ });
    await expectData<unknown>(
      await page.request.put(`/api/v1/organization/groups/${groupId}/members`, {
        data: {
          members: [
            { userId: account(TENANT, 'manager').id, role: 'teacher' },
            { userId: account(TENANT, 'teacher').id, role: 'teacher' },
            { userId: account(TENANT, 'student').id, role: 'member' },
          ],
        },
      }),
      'PUT /api/v1/organization/groups/:id/members',
      200,
    );
    await expectData<unknown>(
      await page.request.put(`/api/v1/organization/groups/${groupId}`, {
        data: { description: GROUP_DESCRIPTION },
      }),
      'PUT /api/v1/organization/groups/:id',
      200,
    );

    // --- Step 3a: the group description, on the manager's group list ----------
    await page.goto('/manage/groups');
    await expect(
      page.getByText(GROUP_DESCRIPTION, { exact: true }).filter({ visible: true }).first(),
    ).toBeVisible();
    await expectNoInjection(page);

    // --- Step 1 + 2: the educator creates the deck, card, bank and question ---
    await loginAs(page, TENANT, 'teacher', { locale: 'pl', waitFor: /\/edu(\/|$)/ });

    const deck = await expectData<{ id: string; name: string }>(
      await page.request.post('/api/v1/flashcards/decks', {
        data: { name: DECK_NAME, visibility: 'group', groupIds: [groupId] },
      }),
      'POST /api/v1/flashcards/decks',
      201,
    );
    await expectData<unknown>(
      await page.request.post('/api/v1/flashcards', {
        data: { deckId: deck.id, front: CARD_FRONT, back: 'Bezpieczna odpowiedź' },
      }),
      'POST /api/v1/flashcards',
      201,
    );
    const bank = await expectData<{ id: string; name: string }>(
      await page.request.post('/api/v1/questions/banks', {
        data: { name: BANK_NAME, visibility: 'group', groupIds: [groupId] },
      }),
      'POST /api/v1/questions/banks',
      201,
    );
    // --- Step 3c: the quiz question the student answers with the script -------
    const question = await expectData<{ id: string }>(
      await page.request.post('/api/v1/questions', {
        data: { bankId: bank.id, type: 'open', content: QUESTION_CONTENT },
      }),
      'POST /api/v1/questions',
      201,
    );

    // Step 1 (list): the deck name is text, not markup.
    await page.goto('/edu/flashcards');
    await expect(
      page.getByText(DECK_NAME, { exact: true }).filter({ visible: true }).first(),
    ).toBeVisible();
    await expectNoInjection(page);

    // Step 2 (preview): the card's Markdown is sanitized in the deck preview.
    await page.goto(`/edu/flashcards/${deck.id}`);
    await expect(
      page.getByRole('heading', { name: DECK_NAME, exact: true }).filter({ visible: true }).first(),
    ).toBeVisible();
    await expectInertKlikLink(page);
    await expectNoInjection(page);

    // Step 3b (list): the question-bank name is text, not markup.
    await page.goto('/edu/questions');
    await expect(
      page.getByText(BANK_NAME, { exact: true }).filter({ visible: true }).first(),
    ).toBeVisible();
    await expectNoInjection(page);

    // --- Publish the assignment that carries the open question ---------------
    const assignment = await expectData<{ id: string }>(
      await page.request.post('/api/v1/teacher/assignments', {
        data: { title: ASSIGNMENT_TITLE },
      }),
      'POST /api/v1/teacher/assignments',
      201,
    );
    await expectData<unknown>(
      await page.request.post(`/api/v1/teacher/assignments/${assignment.id}/questions`, {
        data: { questionIds: [question.id] },
      }),
      'POST /api/v1/teacher/assignments/:id/questions',
      200,
    );
    await expectData<unknown>(
      await page.request.put(`/api/v1/teacher/assignments/${assignment.id}/targets`, {
        data: { groupIds: [groupId] },
      }),
      'PUT /api/v1/teacher/assignments/:id/targets',
      200,
    );
    const published = await expectData<{ status: string }>(
      await page.request.post(`/api/v1/teacher/assignments/${assignment.id}/publish`, {
        data: {},
      }),
      'POST /api/v1/teacher/assignments/:id/publish',
      200,
    );
    expect(published.status, 'the assignment is published').toBe('published');

    // --- Student side: lists, preview, study session, quiz answer, report -----
    await loginAs(page, TENANT, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });

    // Step 1 + 4 (student list + preview).
    await page.goto('/app/flashcards');
    await expect(
      page.getByText(DECK_NAME, { exact: true }).filter({ visible: true }).first(),
    ).toBeVisible();
    await expectNoInjection(page);

    await page.goto(`/app/flashcards/${deck.id}`);
    await expect(
      page.getByRole('heading', { name: DECK_NAME, exact: true }).filter({ visible: true }).first(),
    ).toBeVisible();
    await expectInertKlikLink(page);
    await expectNoInjection(page);

    // Step 3b (student list): the bank name is text in the student's bank list.
    await page.goto('/app/questions');
    await expect(
      page.getByText(BANK_NAME, { exact: true }).filter({ visible: true }).first(),
    ).toBeVisible();
    await expectNoInjection(page);

    // Step 4 (study session): the sanitized card in the cram runner.
    await page.goto(`/app/study/session/cram?deckId=${deck.id}`);
    await expectInertKlikLink(page);
    await expectNoInjection(page);

    // Step 3c: the student answers the open question with the script payload.
    const attempt = await expectData<{ id: string; questions: Array<{ id: string }> }>(
      await page.request.post(`/api/v1/assignments/${assignment.id}/start`, { data: {} }),
      'POST /api/v1/assignments/:id/start',
      200,
    );
    const servedQuestion = attempt.questions[0];
    expect(servedQuestion.id, 'the assignment serves its open question').toBe(question.id);
    await expectData<unknown>(
      await page.request.post(`/api/v1/quiz/${attempt.id}`, {
        data: {
          attemptId: attempt.id,
          answers: [{ questionId: servedQuestion.id, textAnswer: PAYLOAD.script }],
        },
      }),
      'POST /api/v1/quiz/:attemptId',
      200,
    );

    // Step 3d: the student's report message carries the img payload.
    const report = await expectData<{ id: string }>(
      await page.request.post(`/api/v1/questions/${question.id}/reports`, {
        data: { message: REPORT_MESSAGE },
      }),
      'POST /api/v1/questions/:id/reports',
      201,
    );

    // --- Step 4 (teacher view): the quiz answer and the report thread ---------
    await loginAs(page, TENANT, 'teacher', { locale: 'pl', waitFor: /\/edu(\/|$)/ });

    await page.goto(`/edu/assignments/${assignment.id}/results/${account(TENANT, 'student').id}`);
    await expect(
      page
        .getByText(`Odpowiedź ucznia: ${PAYLOAD.script}`, { exact: true })
        .filter({ visible: true })
        .first(),
      'the submitted script is shown as the student answer text',
    ).toBeVisible();
    await expectNoInjection(page);

    await page.goto(`/edu/reports/${report.id}`);
    await expect(
      page.getByText(REPORT_MESSAGE, { exact: true }).filter({ visible: true }).first(),
      'the report message is shown as text',
    ).toBeVisible();
    await expectNoInjection(page);

    // Expected result: no alert() ever fired on any surface.
    expect(dialogs, 'no alert() dialog was opened').toEqual([]);
  });
});
