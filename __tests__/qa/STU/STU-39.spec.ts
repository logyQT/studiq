import { expect, test, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * STU-39 — the student reports a wrong flashcard (`/app/reports`).
 *
 * Case steps: open the flashcard menu, choose „Zgłoś nieprawidłowość”, send
 * „Odpowiedź jest błędna”, then open `/app/reports`.
 *
 * The case was written against the legacy manual seed (`student1@dev.local`,
 * `teacher1@dev.local`, deck `O1G1T1`, password `pass`). The suite version runs on
 * the case's own tenant, seeded with
 *
 *   bun scripts/qa-tenant.ts STU-39 --fresh
 *
 * from `__tests__/qa/profiles/STU-39.json` (`content`): one organization, the default
 * group `G1`, and a `manager` (org `admin`, group `teacher`), an educator
 * (`teacher` — the case's T1) and a `student` (the case's S1, member of `G1`).
 * Every id derives from `tenantKey('qa/cases/STU-39.md', 'STU-39#<suffix>',
 * 'qa-shared')` + `tenantId(key, entity)`; nothing global is read or written (no
 * admin setting, feature flag, plan, platform stat, singleton row or another
 * worker's tenant).
 *
 * Prerequisite, prepared idempotently through the product API:
 * 1. The manager promotes the educator to group `teacher` of `G1` (the seeder
 *    enrols group members as `member`, and only a group teacher may share content
 *    to a group) via `PUT /api/v1/organization/groups/:id/members` — the same
 *    write `/manage/groups` performs.
 * 2. The educator creates the bank `STU-39 bank` shared to `G1` with the question
 *    `STU-39: Ile wynosi 2+2?` — the `O1G1T1` analogue, authored by T1.
 * 3. The educator creates the deck `STU-39 talia` shared to `G1` and one flashcard
 *    linked to that question (`POST /api/v1/flashcards` with `questionId`, the
 *    „Utwórz fiszkę z pytania” flow). Only a card linked to a question offers
 *    „Zgłoś nieprawidłowość”: the report is addressed to the question's author.
 *
 * Acceptance points (walked on the shared app, worker qa-env-8, before writing):
 * 1. The flashcard menu offers „Zgłoś nieprawidłowość”; it opens the dialog
 *    „Zgłoś nieprawidłowość pytania” with the label „Treść zgłoszenia” and a
 *    „Wyślij” button disabled while the report is empty.
 * 2. „Wyślij” posts the report, closes the dialog and raises the toast
 *    „Zgłoszenie wysłane”; the report is addressed to the question's author with
 *    the case's message as its first thread message.
 * 3. `/app/reports` lists that report with the counterpart, the reported
 *    question's content, the status badge „Otwarte” and the last-activity date.
 * 4. The read status („status przeczytania”): right after sending, the reporter's
 *    own report is read — no red unread dot, no „Nieprzeczytane” text, and
 *    `unread-count` agrees with the list. After the teacher replies, the row is
 *    unread (dot + „Nieprzeczytane”, sidebar badge = unread count); opening the
 *    thread shows the message and clears it back to read.
 */

const CASE = 'STU-39';

const BANKS_URL = '/api/v1/questions/banks';
const QUESTIONS_URL = '/api/v1/questions';
const DECKS_URL = '/api/v1/flashcards/decks';
const CARDS_URL = '/api/v1/flashcards';
const REPORTS_URL = '/api/v1/question-reports';

/** The case's content, scoped to this case so a retry reuses it instead of duplicating. */
const BANK_NAME = 'STU-39 bank';
const QUESTION_CONTENT = 'STU-39: Ile wynosi 2+2?';
const DECK_NAME = 'STU-39 talia';
const REPORT_MESSAGE = 'Odpowiedź jest błędna';
const TEACHER_REPLY = 'Dziękuję, poprawię odpowiedź.';

/** Polish copy from `QuestionReports` / `Flashcards` (pl.json). */
const COPY = {
  reportMenu: 'Zgłoś nieprawidłowość',
  dialogTitle: 'Zgłoś nieprawidłowość pytania',
  messageLabel: 'Treść zgłoszenia',
  send: 'Wyślij',
  sent: 'Zgłoszenie wysłane',
  pageTitle: 'Zgłoszenia',
  pageDescription: 'Twoje zgłoszenia nieprawidłowości pytań i odpowiedzi wykładowców.',
  statusOpen: 'Otwarte',
  unread: 'Nieprzeczytane',
  viewDeck: 'Przeglądaj',
} as const;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface GroupMemberRow {
  userId: string;
  role: 'teacher' | 'member';
}

interface BankRow {
  id: string;
  name: string;
  created_by: string;
  organization_id: string | null;
  visibility: 'personal' | 'group';
  groupIds: string[];
}

interface QuestionRow {
  id: string;
  content: string;
  created_by: string;
  organization_id: string | null;
}

interface DeckRow {
  id: string;
  name: string;
  created_by: string;
  visibility: 'personal' | 'group';
  flashcard_count: number;
}

interface FlashcardRow {
  id: string;
  front: string;
  back: string;
  deck_id: string;
  question_id: string | null;
}

interface ReportRow {
  id: string;
  status: 'open' | 'resolved';
  updated_at: string;
  isUnread: boolean;
  reported_by: string;
  teacher_id: string;
  question: { id: string; content: string } | null;
  reporter: { id: string; full_name: string | null; email: string } | null;
  teacher: { id: string; full_name: string | null; email: string } | null;
}

interface ReportListResult {
  items: ReportRow[];
  nextCursor: string | null;
  hasMore: boolean;
}

interface ReportThread {
  report: ReportRow;
  messages: Array<{ id: string; sender_id: string; body: string }>;
}

async function getData<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  expect(response.ok(), `GET ${url} → ${response.status()} ${await response.text()}`).toBe(true);
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(body.success, `GET ${url} success flag`).toBe(true);
  return body.data;
}

/**
 * The seeder enrols group members with the group `member` role, but only a group
 * `teacher` may share content to the group. Promote the educator through the
 * manager's own roster endpoint — the same write `/manage/groups` performs —
 * keeping every other member untouched.
 */
async function ensureEducatorLeadsGroup(page: Page, tenant: QaTenant): Promise<void> {
  const groupId = tenant.group?.id;
  const educator = tenant.users.teacher;
  if (!groupId || !educator) {
    throw new Error(`${CASE} needs the content tenant profile (org, group and educator)`);
  }

  const url = `/api/v1/organization/groups/${groupId}/members`;
  const roster = await getData<GroupMemberRow[]>(page, url);
  const member = roster.find((row) => row.userId === educator.id);
  expect(member, 'the seeded educator is a member of the tenant group').toBeTruthy();
  if (member!.role === 'teacher') return;

  const response = await page.request.put(url, {
    data: {
      members: roster.map((row) =>
        row.userId === educator.id ? { userId: row.userId, role: 'teacher' } : row,
      ),
    },
  });
  expect(response.ok(), `PUT ${url} → ${response.status()} ${await response.text()}`).toBe(true);

  const after = await getData<GroupMemberRow[]>(page, url);
  expect(
    after.find((row) => row.userId === educator.id)?.role,
    'the educator now teaches the tenant group',
  ).toBe('teacher');
}

/** The case's group bank, or the one a retry already created. */
async function ensureBank(page: Page, groupId: string): Promise<BankRow> {
  const banks = await getData<{ items: BankRow[] }>(page, `${BANKS_URL}?limit=100`);
  const existing = banks.items.find((bank) => bank.name === BANK_NAME);
  if (existing) return existing;

  const response = await page.request.post(BANKS_URL, {
    data: { name: BANK_NAME, visibility: 'group', groupIds: [groupId] },
  });
  expect(
    response.status(),
    `POST ${BANKS_URL} (${BANK_NAME}) → ${response.status()} ${await response.text()}`,
  ).toBe(201);
  return ((await response.json()) as ApiEnvelope<BankRow>).data;
}

/** The bank's question, keyed by its content so retries are idempotent. */
async function ensureQuestion(page: Page, bankId: string): Promise<QuestionRow> {
  const url = `${QUESTIONS_URL}?bankId=${bankId}`;
  const questions = await getData<QuestionRow[]>(page, url);
  const existing = questions.find((question) => question.content === QUESTION_CONTENT);
  if (existing) return existing;

  const response = await page.request.post(QUESTIONS_URL, {
    data: {
      bankId,
      type: 'mcq',
      content: QUESTION_CONTENT,
      answers: [
        { content: '4', isCorrect: true, orderIndex: 0 },
        { content: '5', isCorrect: false, orderIndex: 1 },
      ],
    },
  });
  expect(
    response.status(),
    `POST ${QUESTIONS_URL} (${QUESTION_CONTENT}) → ${response.status()} ${await response.text()}`,
  ).toBe(201);
  return ((await response.json()) as ApiEnvelope<QuestionRow>).data;
}

/** The case's deck shared to the student's group (the `O1G1T1` analogue). */
async function ensureDeck(page: Page, groupId: string): Promise<DeckRow> {
  const decks = await getData<{ items: DeckRow[] }>(page, `${DECKS_URL}?limit=200`);
  const existing = decks.items.find((deck) => deck.name === DECK_NAME);
  if (existing) return existing;

  const response = await page.request.post(DECKS_URL, {
    data: { name: DECK_NAME, visibility: 'group', groupIds: [groupId] },
  });
  expect(
    response.status(),
    `POST ${DECKS_URL} (${DECK_NAME}) → ${response.status()} ${await response.text()}`,
  ).toBe(201);
  return ((await response.json()) as ApiEnvelope<DeckRow>).data;
}

/** One card in the deck, linked to the bank question — the report's target. */
async function ensureCard(
  page: Page,
  deckId: string,
  question: QuestionRow,
): Promise<FlashcardRow> {
  const cards = await getData<{ items: FlashcardRow[] }>(
    page,
    `${CARDS_URL}?deckIds=${deckId}&limit=100`,
  );
  const existing = cards.items.find((card) => card.front === QUESTION_CONTENT);
  if (existing) {
    expect(existing.question_id, 'the card is linked to the reported question').toBe(question.id);
    return existing;
  }

  const response = await page.request.post(CARDS_URL, {
    data: { deckId, front: QUESTION_CONTENT, back: '4', questionId: question.id },
  });
  expect(
    response.status(),
    `POST ${CARDS_URL} → ${response.status()} ${await response.text()}`,
  ).toBe(201);
  return ((await response.json()) as ApiEnvelope<FlashcardRow>).data;
}

/** The report list as the signed-in student sees it. */
async function listReports(page: Page): Promise<ReportListResult> {
  return getData<ReportListResult>(page, `${REPORTS_URL}?limit=100`);
}

async function unreadCount(page: Page): Promise<number> {
  return (await getData<{ count: number }>(page, `${REPORTS_URL}/unread-count`)).count;
}

/** Everything the case needs, built inside this tenant only. */
async function prepareTenant(page: Page, tenant: QaTenant): Promise<QuestionRow> {
  const group = tenant.group;
  const teacher = tenant.users.teacher;
  if (!group || !teacher) {
    throw new Error(`${CASE} needs the content tenant profile (org, group, educator, student)`);
  }

  await loginAs(page, tenant, 'manager', { locale: 'pl', waitFor: /\/manage(\/|$)/ });
  await ensureEducatorLeadsGroup(page, tenant);

  await page.context().clearCookies();
  await loginAs(page, tenant, 'teacher', { locale: 'pl', waitFor: /\/edu(\/|$)/ });
  const bank = await ensureBank(page, group.id);
  expect(bank.created_by, 'the bank is owned by the tenant educator').toBe(teacher.id);
  expect(bank.organization_id, 'the bank belongs to the tenant organization').toBe(tenant.org?.id);
  const question = await ensureQuestion(page, bank.id);
  expect(question.created_by, 'the question is owned by the tenant educator').toBe(teacher.id);
  const deck = await ensureDeck(page, group.id);
  expect(deck.created_by, 'the deck is owned by the tenant educator').toBe(teacher.id);
  expect(deck.visibility, 'the deck is shared to the tenant group').toBe('group');
  const card = await ensureCard(page, deck.id, question);
  expect(card.deck_id).toBe(deck.id);

  await page.context().clearCookies();
  await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });
  return question;
}

test.describe('@case:STU-39 @area:STU @prio:P2 report a wrong flashcard', () => {
  test('sends a flashcard report and lists it with its read status', async ({ page, browser }) => {
    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    expect(tenant.key, `${CASE} tenant key`).toContain(`${CASE}.md::${CASE}`);
    expect(
      tenant.runSuffix,
      'seed with --fresh: every independent run owns a new tenant',
    ).toBeTruthy();
    const student = tenant.users.student!;
    const teacher = tenant.users.teacher!;

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const question = await prepareTenant(page, tenant);

    // ── Step 1: the flashcard menu offers „Zgłoś nieprawidłowość” ───────────
    await page.goto('/app/flashcards');
    await expect(page).toHaveURL(/\/app\/flashcards$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

    const deckCard = page
      .locator('[data-slot="card"]')
      .filter({ has: page.getByText(DECK_NAME, { exact: true }) });
    await expect(deckCard, 'the teacher shared the deck with the student').toHaveCount(1);
    await deckCard.getByRole('button', { name: COPY.viewDeck, exact: true }).click();
    await expect(page).toHaveURL(/\/app\/flashcards\/[0-9a-f-]+$/);
    await expect(
      page.getByText(QUESTION_CONTENT, { exact: true }).filter({ visible: true }).first(),
      'the deck shows the card created from the question',
    ).toBeVisible();

    // The card's „Więcej akcji fiszki” trigger exists in a mobile and a desktop
    // variant (one CSS-hidden per breakpoint); only the desktop one is visible.
    const cardMenu = page
      .getByRole('button', { name: 'Więcej akcji fiszki', exact: true })
      .filter({ visible: true });
    await expect(cardMenu, 'the card menu trigger').toHaveCount(1);
    await cardMenu.click();

    const reportItem = page.getByRole('menuitem', { name: COPY.reportMenu, exact: true });
    await expect(reportItem, '„Zgłoś nieprawidłowość” in the flashcard menu').toBeVisible();
    await reportItem.click();

    // ── Step 2: the case's message and „Wyślij” ─────────────────────────────
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText(COPY.dialogTitle, { exact: true }),
      'the dialog is the case’s „Zgłoś nieprawidłowość pytania”',
    ).toBeVisible();
    await expect(dialog.getByText(COPY.messageLabel, { exact: true })).toBeVisible();

    const message = dialog.locator('textarea');
    const send = dialog.getByRole('button', { name: COPY.send, exact: true });
    await expect(message).toHaveValue('');
    await expect(send, '„Wyślij” is disabled while the report is empty').toBeDisabled();

    await message.fill(REPORT_MESSAGE);
    await expect(message).toHaveValue(REPORT_MESSAGE);
    await expect(send).toBeEnabled();

    const createResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `${QUESTIONS_URL}/${question.id}/reports`,
    );
    await send.click();
    const created = await createResponse;
    expect(created.status(), `POST ${QUESTIONS_URL}/${question.id}/reports`).toBe(201);
    const report = ((await created.json()) as ApiEnvelope<{ id: string }>).data;
    expect(report.id, 'the API returned the created report').toBeTruthy();

    await expect(page.getByText(COPY.sent, { exact: true }), 'the sent toast').toBeVisible();
    await expect(dialog, 'the dialog closes after sending').toHaveCount(0);

    // The report is addressed to the question's author, with the case's message.
    const thread = await getData<ReportThread>(page, `${REPORTS_URL}/${report.id}`);
    expect(thread.report.question?.id, 'the report targets the case question').toBe(question.id);
    expect(thread.report.reported_by, 'the reporter is the tenant student').toBe(student.id);
    expect(thread.report.teacher_id, 'the recipient is the question’s author').toBe(teacher.id);
    expect(thread.report.status, 'a new report is open').toBe('open');
    expect(thread.messages, 'the report holds its first message').toHaveLength(1);
    expect(thread.messages[0].body, 'the report keeps the case’s message').toBe(REPORT_MESSAGE);
    expect(thread.messages[0].sender_id, 'the message is the student’s').toBe(student.id);

    // ── Step 3: the report on /app/reports ──────────────────────────────────
    await page.goto('/app/reports');
    await expect(page).toHaveURL(/\/app\/reports$/);
    await expect(
      page.locator('[data-slot="breadcrumb"]').getByText(COPY.pageTitle, { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: COPY.pageTitle, exact: true })).toBeVisible();
    await expect(page.getByText(COPY.pageDescription, { exact: true })).toBeVisible();

    const reports = await listReports(page);
    const listed = reports.items.find((item) => item.id === report.id);
    expect(listed, 'the report is listed for its reporter').toBeTruthy();
    expect(listed!.question?.content, 'the row carries the reported question').toBe(
      QUESTION_CONTENT,
    );

    const author = listed!.teacher?.full_name ?? listed!.teacher?.email;
    expect(author, 'the row carries the counterpart').toBeTruthy();

    const row = page.locator(`a[href="/app/reports/${report.id}"]`);
    await expect(row, 'the report row').toHaveCount(1);
    await expect(row.getByText(author!, { exact: true })).toBeVisible();
    await expect(row.getByText(QUESTION_CONTENT, { exact: true })).toBeVisible();
    await expect(row.getByText(COPY.statusOpen, { exact: true })).toBeVisible();

    const time = row.locator('time');
    await expect(time, 'the row shows the last activity').toHaveAttribute(
      'datetime',
      listed!.updated_at,
    );
    await expect(time).toHaveText(
      new Date(listed!.updated_at).toLocaleDateString('pl', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }),
    );

    // „Status przeczytania”: the reporter's own message is read by definition.
    expect(listed!.isUnread, 'the student’s own new report is not unread').toBe(false);
    await expect(
      row.getByText(COPY.unread, { exact: true }),
      'a read report carries no „Nieprzeczytane” marker',
    ).toHaveCount(0);
    await expect(row.locator('span[aria-hidden="true"].bg-red-500')).toHaveCount(0);
    expect(await unreadCount(page), 'no unread report for the student').toBe(
      reports.items.filter((item) => item.isUnread).length,
    );

    // ── Adjacent regression: the teacher's reply makes the row unread ───────
    const teacherContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
    try {
      const teacherPage = await teacherContext.newPage();
      await loginAs(teacherPage, tenant, 'teacher', {
        locale: 'pl',
        waitFor: /\/edu(\/|$)/,
      });
      const reply = await teacherPage.request.post(`${REPORTS_URL}/${report.id}/messages`, {
        data: { body: TEACHER_REPLY },
      });
      expect(
        reply.status(),
        `POST ${REPORTS_URL}/${report.id}/messages → ${reply.status()} ${await reply.text()}`,
      ).toBe(201);
    } finally {
      await teacherContext.close();
    }

    await page.reload();
    await expect(
      row.getByText(COPY.unread, { exact: true }),
      'the teacher’s reply marks the report unread for the student',
    ).toHaveCount(1);
    await expect(row.locator('span[aria-hidden="true"].bg-red-500')).toBeVisible();

    const unreadAfterReply = await unreadCount(page);
    const reportsAfterReply = await listReports(page);
    expect(
      reportsAfterReply.items.find((item) => item.id === report.id)?.isUnread,
      'the API agrees the report is unread',
    ).toBe(true);
    expect(unreadAfterReply, 'the unread counter counts the report').toBeGreaterThan(0);
    expect(
      reportsAfterReply.items.filter((item) => item.isUnread),
      'the unread counter agrees with the list',
    ).toHaveLength(unreadAfterReply);

    const navLink = page.locator('a[href="/app/reports"]');
    await expect(navLink, 'one „Zgłoszenia” entry in the student sidebar').toHaveCount(1);
    await expect(navLink.locator('span.rounded-full'), 'the unread badge').toHaveText(
      String(unreadAfterReply),
    );

    // ── The thread shows the report and opening it clears the marker ────────
    const markRead = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `${REPORTS_URL}/${report.id}/read`,
    );
    await row.click();
    await expect(page).toHaveURL(new RegExp(`/app/reports/${report.id}$`));
    await expect(
      page.getByText(REPORT_MESSAGE, { exact: true }),
      'the thread shows the report’s message',
    ).toBeVisible();
    await expect(page.getByText(TEACHER_REPLY, { exact: true })).toBeVisible();
    expect((await markRead).ok(), 'opening the thread marks the report read').toBe(true);
    await expect
      .poll(
        async () => (await listReports(page)).items.find((item) => item.id === report.id)?.isUnread,
        { message: 'the read receipt is stored' },
      )
      .toBe(false);

    await page.goto('/app/reports');
    await expect(
      row.getByText(COPY.unread, { exact: true }),
      'opening the thread marks the report read again',
    ).toHaveCount(0);
    const afterRead = await listReports(page);
    expect(
      afterRead.items.find((item) => item.id === report.id)?.isUnread,
      'the API agrees the report is read again',
    ).toBe(false);

    expect(pageErrors, 'no uncaught page errors').toEqual([]);
  });
});
