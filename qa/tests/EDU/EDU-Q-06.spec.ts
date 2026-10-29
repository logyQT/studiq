import { expect, test, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * EDU-Q-06 — creating a flashcard from a question („Utwórz fiszkę z pytania”).
 *
 * Case (verbatim → tenant model): in the question table the educator clicks the
 * „Utwórz fiszkę z tego pytania” icon, picks a deck or „Nowa talia” with a name and
 * saves. A student of the group then reports the flashcard (STU-39). The created
 * card must carry the question as its front and the correct answer as its back,
 * and stay linked to the question so the report reaches the question's author.
 *
 * Tenant (`content` profile, fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts EDU-Q-06 --fresh
 *
 * gives the org `qa-edu-q-06-<suffix>` with a manager, an educator and a student,
 * plus the default group `G1`. Every id derives from `tenantKey('qa/cases/EDU-Q-06.md',
 * 'EDU-Q-06#<suffix>', 'qa-shared')` + `tenantId`, so nothing global is read or
 * written: no admin setting, feature flag, plan, platform stat or singleton row.
 *
 * The case was written against the legacy seed (`teacher1@dev.local`, `student1@dev.local`,
 * `O1G1`). In the tenant model the educator owns one group question bank (question
 * „EDU-Q-06 Jaka jest stolica Francji?”, correct answer „Paryż”) and one deck shared
 * to `G1`; the seeded student is a `G1` member. Both are prepared through the product
 * API, because `seedTenantGraph` only builds the org/group/user graph. The seeder
 * enrolls group members as group `member` and only a group `teacher` may share
 * content to a group, so the spec promotes the educator through the manager's own
 * group-roster endpoint first (tenant-local, idempotent).
 *
 * Acceptance points (confirmed on the shared app, worker qa-env-5, before writing):
 * 1. The question row offers the „Utwórz fiszkę z tego pytania” action; the dialog is
 *    titled „Utwórz fiszkę z pytania”, explains the question link and prefills the
 *    front with the question content and the back with the correct answer.
 * 2. „Nowa talia” + a name creates a personal deck with the card in it; the toast is
 *    „Fiszka utworzona”, and the stored card keeps `front`, `back` and `question_id`.
 * 3. Choosing the existing group deck creates the same card there with `group`
 *    visibility; the educator's deck view renders the question/answer pair.
 * 4. The `G1` student opens the shared deck, and only the card linked to the question
 *    offers „Zgłoś nieprawidłowość” (a standalone card does not). The report dialog is
 *    titled „Zgłoś nieprawidłowość pytania” and says the message reaches the question
 *    author; sending shows „Zgłoszenie wysłane”.
 * 5. The report is stored against the question (`teacher_id` = question author,
 *    `question_id` = the source question) and appears on the educator's `/edu/reports`
 *    list with the question content and „Otwarte”.
 */

const CASE = 'EDU-Q-06';

const BANKS_URL = '/api/v1/questions/banks';
const QUESTIONS_URL = '/api/v1/questions';
const DECKS_URL = '/api/v1/flashcards/decks';
const CARDS_URL = '/api/v1/flashcards';
const REPORTS_URL = '/api/v1/question-reports';

/** Polish copy from `AnswerQuestion`/`QuestionBankDetail`/`CreateFlashcardFromQuestion`/`QuestionReports`. */
const COPY = {
  createFlashcard: 'Utwórz fiszkę z tego pytania',
  dialogTitle: 'Utwórz fiszkę z pytania',
  dialogDescription: 'Fiszka zostanie powiązana z pytaniem',
  deckPlaceholder: 'Wybierz talię...',
  newDeckOption: 'Nowa talia',
  newDeckPlaceholder: 'Nazwa nowej talii...',
  created: 'Fiszka utworzona',
  create: 'Utwórz',
  menuReport: 'Zgłoś nieprawidłowość',
  reportDialogTitle: 'Zgłoś nieprawidłowość pytania',
  reportDialogDescription: 'Wiadomość trafi bezpośrednio do wykładowcy, który stworzył to pytanie.',
  reportSent: 'Zgłoszenie wysłane',
  reportOpen: 'Otwarte',
} as const;

const BANK_NAME = 'EDU-Q-06 Bank pytań';
const DECK = {
  group: 'EDU-Q-06 talia grupowa',
  newDeck: 'EDU-Q-06 nowa talia',
} as const;
const CARD = {
  standalone: 'EDU-Q-06 karta bez pytania',
} as const;
const QUESTION_CONTENT = 'EDU-Q-06 Jaka jest stolica Francji?';
const CORRECT_ANSWER = 'Paryż';
const WRONG_ANSWER = 'Lyon';
const REPORT_MESSAGE = 'Odpowiedź jest błędna';

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface GroupMemberRow {
  userId: string;
  role: 'teacher' | 'member';
}

interface BankListItem {
  id: string;
  name: string;
  visibility: 'personal' | 'group';
  groupIds: string[];
  created_by: string;
}

interface BankListResult {
  items: BankListItem[];
}

interface QuestionItem {
  id: string;
  content: string;
  created_by: string;
  question_answers: { content: string; is_correct: boolean }[];
}

interface DeckListItem {
  id: string;
  name: string;
  created_by: string;
  visibility: 'personal' | 'group';
  groupIds: string[];
}

interface DeckListResult {
  items: DeckListItem[];
}

interface FlashcardItem {
  id: string;
  front: string;
  back: string;
  deck_id: string;
  question_id: string | null;
  visibility: 'personal' | 'group';
}

interface FlashcardListResult {
  items: FlashcardItem[];
}

interface ReportListItem {
  id: string;
  organization_id: string | null;
  status: 'open' | 'resolved';
  question: { id: string; content: string } | null;
  teacher: { id: string; email: string } | null;
  reporter: { id: string; email: string } | null;
}

interface ReportListResult {
  items: ReportListItem[];
}

interface ReportDetail {
  report: ReportListItem & { reported_by: string; teacher_id: string; canResolve: boolean };
  messages: { body: string; sender_id: string }[];
}

/** `GET` an endpoint as the signed-in user and unwrap the response envelope. */
async function getData<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  expect(response.ok(), `GET ${url} → ${response.status()} ${await response.text()}`).toBe(true);
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(body.success, `GET ${url} success flag`).toBe(true);
  return body.data;
}

/** Mutating request with an exact expected status; returns the unwrapped `data`. */
async function sendData<T>(
  page: Page,
  method: 'post' | 'put' | 'delete',
  url: string,
  status: number,
  data?: unknown,
): Promise<T> {
  const response = await page.request[method](url, data === undefined ? undefined : { data });
  expect(
    response.status(),
    `${method.toUpperCase()} ${url} → ${response.status()} ${await response.text()}`,
  ).toBe(status);
  const text = await response.text();
  return (text ? (JSON.parse(text) as ApiEnvelope<T>).data : undefined) as T;
}

async function listDecks(page: Page): Promise<DeckListItem[]> {
  const result = await getData<DeckListResult>(page, `${DECKS_URL}?limit=200`);
  return result.items;
}

/** Cards of one deck as the screen lists them (`deckIds`, then an exact `deck_id` check). */
async function listCards(page: Page, deckId: string): Promise<FlashcardItem[]> {
  const result = await getData<FlashcardListResult>(
    page,
    `${CARDS_URL}?deckIds=${deckId}&sortBy=created_at&sortOrder=desc&limit=100`,
  );
  return result.items.filter((card) => card.deck_id === deckId);
}

/**
 * The tenant seeder enrolls group members with the group `member` role, but only a
 * group `teacher` may share a bank/deck to the group (`canShareContentToGroups`).
 * Promote the educator through the manager's own roster endpoint — the same write
 * `/manage/groups` performs.
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

  await sendData(page, 'put', url, 200, {
    members: roster.map((row) =>
      row.userId === educator.id ? { userId: row.userId, role: 'teacher' } : row,
    ),
  });

  const after = await getData<GroupMemberRow[]>(page, url);
  expect(
    after.find((row) => row.userId === educator.id)?.role,
    'the educator now teaches the tenant group',
  ).toBe('teacher');
}

/** The case's group question bank, created once per tenant (idempotent for CI retries). */
async function ensureBank(page: Page, groupId: string): Promise<BankListItem> {
  const banks = await getData<BankListResult>(page, `${BANKS_URL}?limit=100`);
  const existing = banks.items.find((bank) => bank.name === BANK_NAME);
  if (existing) {
    expect(existing.visibility, 'the case bank is shared to the group').toBe('group');
    expect(existing.groupIds, 'the case bank belongs to the tenant group').toEqual([groupId]);
    return existing;
  }

  const created = await sendData<BankListItem>(page, 'post', BANKS_URL, 201, {
    name: BANK_NAME,
    description: 'Fiszka tworzona z pytania (EDU-Q-06)',
    visibility: 'group',
    groupIds: [groupId],
  });
  return created;
}

/** The single MCQ question of the case, created once per tenant. */
async function ensureQuestion(page: Page, bankId: string): Promise<QuestionItem> {
  const questions = await getData<QuestionItem[]>(page, `${QUESTIONS_URL}?bankId=${bankId}`);
  const existing = questions.find((question) => question.content === QUESTION_CONTENT);
  if (existing) {
    expect(
      existing.question_answers.find((answer) => answer.is_correct)?.content,
      'the question keeps its correct answer',
    ).toBe(CORRECT_ANSWER);
    return existing;
  }

  const created = await sendData<QuestionItem>(page, 'post', QUESTIONS_URL, 201, {
    bankId,
    type: 'mcq',
    content: QUESTION_CONTENT,
    explanation: CORRECT_ANSWER,
    answers: [
      { content: CORRECT_ANSWER, isCorrect: true, orderIndex: 0 },
      { content: WRONG_ANSWER, isCorrect: false, orderIndex: 1 },
    ],
  });
  return created;
}

/** One of the case's decks; created through the product API when missing. */
async function ensureDeck(
  page: Page,
  name: string,
  data: { visibility: 'personal' | 'group'; groupIds?: string[] },
): Promise<DeckListItem> {
  const existing = (await listDecks(page)).find((deck) => deck.name === name);
  if (existing) return existing;

  const created = await sendData<DeckListItem>(page, 'post', DECKS_URL, 201, { name, ...data });
  return created;
}

/**
 * Start each attempt from the same state: no deck left by „Nowa talia” and no card
 * in the group deck. CI seeds the case tenant once and reuses it for every retry, so
 * without this the deck picker would grow and the deck view would show older cards.
 */
async function cleanAttemptState(page: Page, groupDeckId: string): Promise<void> {
  for (const deck of (await listDecks(page)).filter((item) => item.name === DECK.newDeck)) {
    await sendData(page, 'delete', `${DECKS_URL}/${deck.id}`, 200);
  }
  for (const card of await listCards(page, groupDeckId)) {
    await sendData(page, 'delete', `${CARDS_URL}/${card.id}`, 200);
  }
}

/**
 * Prepare the tenant's content: the manager promotes the educator to group teacher,
 * the educator shares a bank with the case's question and a deck to `G1`, and the
 * attempt-scoped leftovers are removed.
 */
async function prepareTenant(
  page: Page,
  tenant: QaTenant,
): Promise<{ bank: BankListItem; question: QuestionItem; groupDeck: DeckListItem }> {
  const group = tenant.group;
  if (!group || !tenant.users.teacher || !tenant.users.manager) {
    throw new Error(`${CASE} needs the content tenant profile (org, group and staff users)`);
  }

  await loginAs(page, tenant, 'manager', { locale: 'pl', waitFor: /\/manage(\/|$)/ });
  await ensureEducatorLeadsGroup(page, tenant);

  await page.context().clearCookies();
  await loginAs(page, tenant, 'teacher', { locale: 'pl', waitFor: /\/edu(\/|$)/ });

  const bank = await ensureBank(page, group.id);
  const question = await ensureQuestion(page, bank.id);
  const groupDeck = await ensureDeck(page, DECK.group, {
    visibility: 'group',
    groupIds: [group.id],
  });
  await cleanAttemptState(page, groupDeck.id);

  return { bank, question, groupDeck };
}

/** The visible actions menu of one card (the desktop copy; the mobile copy has zero size). */
function cardMenu(page: Page, cardId: string) {
  return page.locator(`#fc-${cardId} [data-slot="dropdown-menu-trigger"]:visible`);
}

test.describe('@case:EDU-Q-06 @area:EDU @prio:P2 flashcard from a question', () => {
  test('creates a linked flashcard from the question and routes the student report to its author', async ({
    page,
  }) => {
    test.setTimeout(150_000);

    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    const org = tenant.org;
    const group = tenant.group;
    const educator = tenant.users.teacher;
    const student = tenant.users.student;
    if (!org || !group || !educator || !student) {
      throw new Error(`${CASE} needs the content tenant profile (org, group, educator, student)`);
    }

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const { bank, question, groupDeck } = await prepareTenant(page, tenant);

    // ── Step 1: the question table's „Utwórz fiszkę z tego pytania” action ──
    await page.goto(`/edu/questions/${bank.id}`);
    await expect(page).toHaveURL(new RegExp(`/edu/questions/${bank.id}$`));
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

    const questionRow = page.locator('tbody tr').filter({ hasText: QUESTION_CONTENT });
    await expect(questionRow, 'the case question is listed in its bank').toBeVisible();

    await questionRow.getByRole('button', { name: COPY.createFlashcard, exact: true }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: COPY.dialogTitle })).toBeVisible();
    await expect(dialog).toContainText(COPY.dialogDescription);

    // Front = question content, back = the correct answer — prefilled, still editable.
    const [front, back] = [dialog.locator('textarea').nth(0), dialog.locator('textarea').nth(1)];
    await expect(front, 'front is prefilled with the question').toHaveValue(QUESTION_CONTENT);
    await expect(back, 'back is prefilled with the correct answer').toHaveValue(CORRECT_ANSWER);

    // ── Step 2a: „Nowa talia” with a name ──────────────────────────────────
    const deckTrigger = dialog.locator('[data-slot="select-trigger"]');
    await expect(deckTrigger).toContainText(COPY.deckPlaceholder);
    await deckTrigger.click();
    await expect(
      page.getByRole('option', { name: DECK.group, exact: true }),
      'the existing group deck is offered',
    ).toBeVisible();
    await expect(page.getByRole('option', { name: new RegExp(COPY.newDeckOption) })).toBeVisible();
    await page.getByRole('option', { name: new RegExp(COPY.newDeckOption) }).click();

    const newDeckInput = dialog.locator(`input[placeholder="${COPY.newDeckPlaceholder}"]`);
    await expect(newDeckInput).toBeVisible();
    await newDeckInput.fill(DECK.newDeck);
    await dialog.getByRole('button', { name: COPY.create, exact: true }).click();

    await expect(page.getByText(COPY.created, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const newDeck = (await listDecks(page)).find((deck) => deck.name === DECK.newDeck);
    expect(newDeck, '„Nowa talia” created the named deck').toBeTruthy();
    expect(newDeck!.created_by, 'the new deck belongs to the educator').toBe(educator.id);
    expect(newDeck!.visibility, 'a deck created here is personal').toBe('personal');

    const newDeckCards = await listCards(page, newDeck!.id);
    expect(newDeckCards, 'the new deck holds exactly the created card').toHaveLength(1);
    expect(newDeckCards[0].front, 'stored front = question content').toBe(QUESTION_CONTENT);
    expect(newDeckCards[0].back, 'stored back = correct answer').toBe(CORRECT_ANSWER);
    expect(newDeckCards[0].question_id, 'the card is linked to the question').toBe(question.id);

    // ── Step 2b: pick an existing (group-shared) deck ──────────────────────
    await questionRow.getByRole('button', { name: COPY.createFlashcard, exact: true }).click();
    const secondDialog = page.getByRole('dialog');
    await expect(secondDialog).toBeVisible();
    await secondDialog.locator('[data-slot="select-trigger"]').click();
    await page.getByRole('option', { name: DECK.group, exact: true }).click();
    await secondDialog.getByRole('button', { name: COPY.create, exact: true }).click();

    await expect(page.getByText(COPY.created, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const groupCards = await listCards(page, groupDeck.id);
    expect(groupCards, 'the group deck holds exactly the created card').toHaveLength(1);
    const linkedCard = groupCards[0];
    expect(linkedCard.front, 'stored front = question content').toBe(QUESTION_CONTENT);
    expect(linkedCard.back, 'stored back = correct answer').toBe(CORRECT_ANSWER);
    expect(linkedCard.question_id, 'the card is linked to the question').toBe(question.id);
    expect(linkedCard.visibility, 'a card in a group deck is group-visible').toBe('group');

    // The educator's own deck view renders the question / answer pair.
    await page.goto(`/edu/flashcards/${groupDeck.id}`);
    const educatorCard = page.locator(`#fc-${linkedCard.id}`);
    await expect(educatorCard).toContainText(QUESTION_CONTENT);
    await expect(educatorCard).toContainText(CORRECT_ANSWER);

    // ── Step 3: the G1 student reports the card ─────────────────────────────
    // A standalone card (no question link) must not offer the report action: it is
    // the question link, not the deck, that routes the report.
    const standalone = await sendData<FlashcardItem>(page, 'post', CARDS_URL, 201, {
      deckId: groupDeck.id,
      front: CARD.standalone,
      back: 'brak powiązania',
    });
    expect(standalone.question_id, 'the standalone card has no question link').toBeNull();

    await page.context().clearCookies();
    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });
    await page.goto(`/app/flashcards/${groupDeck.id}`);
    await expect(page).toHaveURL(new RegExp(`/app/flashcards/${groupDeck.id}$`));

    const linkedCardView = page.locator(`#fc-${linkedCard.id}`);
    await expect(linkedCardView, 'the G1 student sees the shared card').toBeVisible();
    await expect(linkedCardView).toContainText(QUESTION_CONTENT);
    await expect(linkedCardView).toContainText(CORRECT_ANSWER);

    const standaloneView = page.locator(`#fc-${standalone.id}`);
    await expect(standaloneView).toBeVisible();
    await cardMenu(page, standalone.id).click();
    await expect(
      page.getByRole('menuitem', { name: COPY.menuReport }),
      'a card without a question link has no report action',
    ).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menuitem')).toHaveCount(0);

    await cardMenu(page, linkedCard.id).click();
    await page.getByRole('menuitem', { name: COPY.menuReport }).click();

    const reportDialog = page.getByRole('dialog');
    await expect(reportDialog).toBeVisible();
    await expect(reportDialog.getByRole('heading', { name: COPY.reportDialogTitle })).toBeVisible();
    await expect(
      reportDialog,
      'the dialog promises the report reaches the question author',
    ).toContainText(COPY.reportDialogDescription);

    const reportUrl = `/api/v1/questions/${question.id}/reports`;
    const reportCreated = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && new URL(response.url()).pathname === reportUrl,
    );
    await reportDialog.locator('textarea').fill(REPORT_MESSAGE);
    await reportDialog.getByRole('button', { name: 'Wyślij', exact: true }).click();

    const reportResponse = await reportCreated;
    expect(reportResponse.status(), `POST ${reportUrl}`).toBe(201);
    const reportBody = (await reportResponse.json()) as ApiEnvelope<ReportListItem>;
    const reportId = reportBody.data.id;
    await expect(page.getByText(COPY.reportSent, { exact: true }).first()).toBeVisible();

    // The reporter sees their own report in the student list.
    const studentReports = await getData<ReportListResult>(page, `${REPORTS_URL}?limit=50`);
    const ownReport = studentReports.items.find((item) => item.id === reportId);
    expect(ownReport, 'the report is stored for the reporter').toBeTruthy();
    expect(ownReport!.question?.content, 'the report targets the question').toBe(QUESTION_CONTENT);
    expect(ownReport!.teacher?.id, 'the recipient is the question author').toBe(educator.id);
    expect(ownReport!.status).toBe('open');

    // ── The report lands with the question author (the educator) ────────────
    await page.context().clearCookies();
    await loginAs(page, tenant, 'teacher', { locale: 'pl', waitFor: /\/edu(\/|$)/ });

    const detail = await getData<ReportDetail>(page, `${REPORTS_URL}/${reportId}`);
    expect(detail.report.question?.id, 'the report keeps the question link').toBe(question.id);
    expect(detail.report.teacher_id, 'the report is addressed to the question author').toBe(
      educator.id,
    );
    expect(detail.report.reported_by, 'the report comes from the G1 student').toBe(student.id);
    expect(detail.report.organization_id, 'the report stays inside the tenant org').toBe(org.id);
    expect(detail.report.status).toBe('open');
    expect(detail.report.canResolve, 'the author may resolve the report').toBe(true);
    expect(detail.messages.map((message) => message.body)).toEqual([REPORT_MESSAGE]);

    await page.goto('/edu/reports');
    await expect(page).toHaveURL(/\/edu\/reports$/);
    const reportRow = page
      .locator('[data-slot="card"]')
      .filter({ hasText: QUESTION_CONTENT })
      .first();
    await expect(reportRow, 'the educator sees the report with the question content').toBeVisible();
    await expect(reportRow).toContainText(COPY.reportOpen);
    await expect(reportRow).toContainText('QA student');

    expect(pageErrors, 'uncaught page errors during the walk').toEqual([]);
  });
});
