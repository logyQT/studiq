import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs } from '@qa/fixtures/qa-tenant';

/**
 * EDU-Q-05 — editing and deleting a question (`/edu/questions/<bankId>`).
 *
 * Case steps: edit a multiple-choice question and change the correct answer, save; then
 * delete the question and confirm „Usunąć pytanie?”. Expected: the toasts „Pytanie
 * zaktualizowane” / „Pytanie usunięte”, the edited row reflecting the saved values, and the
 * deleted question gone from the list.
 *
 * Tenant (deterministic, `content` profile, fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts EDU-Q-05 --fresh
 *
 * gives the organization `qa-edu-q-05-<suffix>` with a manager (org `admin`), an educator
 * (org `member`, the case's T1 analogue) and a student, plus the default group `G1`
 * (`tenantKey('qa/cases/EDU-Q-05.md', 'EDU-Q-05#<suffix>', 'qa-shared')` + `tenantId` for
 * every id). The legacy accounts of the manual seed (`teacher1@dev.local`, `pass`) are never
 * used. The educator's default `question.*` scope is `own`, which is all the case needs
 * because it edits and deletes the question it created.
 *
 * The case's prerequisite (EDU-Q-02: bank „Fizyka” + a 4-answer multiple-choice question
 * with one correct answer, an explanation and a topic) is built by the spec through the same
 * product endpoints the UI calls. The run is idempotent on a reused tenant: the bank and the
 * topic are reused when they already exist, and any question left behind by an interrupted
 * run (`INITIAL.content` or `EDITED.content`) is deleted before the new one is created.
 *
 * Acceptance points (walked on the shared app, worker qa-env-3, `NEXT_LOCALE=pl`):
 * 1. The row shows the question with the „Wielokrotnego wyboru” type badge, the topic badge,
 *    the answer count `4` and the „Edytuj” / „Usuń” actions for its author.
 * 2. „Edytuj pytanie” opens pre-filled with the content, all four answers, exactly the first
 *    radio checked, the explanation and the topic. Saving a new content, a new explanation
 *    and a different correct answer shows „Pytanie zaktualizowane”, re-renders the row and
 *    stores exactly one correct answer — the new one.
 * 3. „Usunąć pytanie?” carries the warning „To trwale usunie to pytanie i wszystkie jego
 *    odpowiedzi. Tej akcji nie można cofnąć.”; „Anuluj” keeps the question, „Usuń” shows
 *    „Pytanie usunięte”, removes the row, shows the empty state and makes
 *    `GET /api/v1/questions/:id` answer 404.
 *
 * Recorded, not asserted: deleting a question that is used by a quiz succeeds (no block) and
 * the question disappears from the quiz (`quiz_questions` cascades). The case asks to record
 * that behaviour rather than judge it, so it is documented in the reconciled case and left
 * out of the spec.
 */

const CASE = 'EDU-Q-05';

const BANKS_URL = '/api/v1/questions/banks';
const QUESTIONS_URL = '/api/v1/questions';
const TOPICS_URL = '/api/v1/topics';

/** Polish copy from `QuestionBankDetail` / `QuestionForm` (`pl.json`) and the walk. */
const COPY = {
  edit: 'Edytuj',
  delete: 'Usuń',
  editTitle: 'Edytuj pytanie',
  editDescription: 'Zaktualizuj szczegóły pytania',
  questionPlaceholder: 'Wpisz swoje pytanie...',
  answersLabel: 'Odpowiedzi',
  answerPlaceholder: (index: number) => `Odpowiedź ${index}`,
  explanationPlaceholder: 'Wyjaśnij, dlaczego odpowiedź jest poprawna...',
  update: 'Aktualizuj',
  updated: 'Pytanie zaktualizowane',
  deleteTitle: 'Usunąć pytanie?',
  deleteDescription:
    'To trwale usunie to pytanie i wszystkie jego odpowiedzi. Tej akcji nie można cofnąć.',
  cancel: 'Anuluj',
  deleted: 'Pytanie usunięte',
  emptyState: 'Brak pytań w tym banku. Utwórz swoje pierwsze pytanie!',
  mcqType: 'Wielokrotnego wyboru',
} as const;

/** The prerequisite bank of EDU-Q-02. */
const BANK = { name: 'Fizyka', description: 'Bank z fizyki' } as const;
const TOPIC = 'Kinematyka';

/**
 * The question as EDU-Q-02 leaves it, and as the case's step 1 edits it. Editing the content
 * as well keeps the edited question coherent with its new correct answer (mass → kilogram).
 */
const INITIAL = {
  content: 'Jaka jest jednostka prędkości w układzie SI?',
  explanation: 'Prędkość mierzymy w metrach na sekundę.',
  answers: ['metr na sekundę', 'metr', 'kilogram', 'sekunda'],
  correctIndex: 0,
} as const;

const EDITED = {
  content: 'Jaka jest jednostka masy w układzie SI?',
  explanation: 'Masę mierzymy w kilogramach.',
  correctIndex: 2,
} as const;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface BankSummary {
  id: string;
  name: string;
  description: string | null;
  created_by: string;
}

interface TopicSummary {
  id: string;
  name: string;
}

interface QuestionAnswer {
  id: string;
  content: string;
  is_correct: boolean;
  order_index: number;
}

interface QuestionSummary {
  id: string;
  type: string;
  content: string;
  explanation: string | null;
  question_answers: QuestionAnswer[];
  topics?: TopicSummary[];
}

function unwrap<T>(body: unknown, what: string): T {
  const envelope = body as ApiEnvelope<T>;
  expect(envelope.success, `${what} success flag`).toBe(true);
  return envelope.data;
}

async function listBanks(api: APIRequestContext): Promise<BankSummary[]> {
  const res = await api.get(`${BANKS_URL}?limit=100`);
  expect(res.status(), `GET ${BANKS_URL} → ${await res.text()}`).toBe(200);
  return unwrap<{ items: BankSummary[] }>(await res.json(), `GET ${BANKS_URL}`).items;
}

/** The case's „Bank Fizyka”, created through the same endpoint the „Nowy bank” dialog calls. */
async function ensureBank(api: APIRequestContext): Promise<BankSummary> {
  const existing = (await listBanks(api)).find((bank) => bank.name === BANK.name);
  if (existing) return existing;

  const res = await api.post(BANKS_URL, {
    data: { name: BANK.name, description: BANK.description },
  });
  expect(res.status(), `POST ${BANKS_URL} → ${await res.text()}`).toBe(201);
  return unwrap<BankSummary>(await res.json(), `POST ${BANKS_URL}`);
}

async function listTopics(api: APIRequestContext): Promise<TopicSummary[]> {
  const res = await api.get(`${TOPICS_URL}?limit=200`);
  expect(res.status(), `GET ${TOPICS_URL} → ${await res.text()}`).toBe(200);
  return unwrap<{ items: TopicSummary[] }>(await res.json(), `GET ${TOPICS_URL}`).items;
}

/** The question's topic; the question dialog has no create-topic action, so it is seeded first. */
async function ensureTopic(api: APIRequestContext): Promise<TopicSummary> {
  const existing = (await listTopics(api)).find((topic) => topic.name === TOPIC);
  if (existing) return existing;

  const res = await api.post(TOPICS_URL, { data: { name: TOPIC } });
  expect(res.status(), `POST ${TOPICS_URL} → ${await res.text()}`).toBe(201);
  return unwrap<TopicSummary>(await res.json(), `POST ${TOPICS_URL}`);
}

async function listQuestions(api: APIRequestContext, bankId: string): Promise<QuestionSummary[]> {
  const url = `${QUESTIONS_URL}?bankId=${bankId}`;
  const res = await api.get(url);
  expect(res.status(), `GET ${url} → ${await res.text()}`).toBe(200);
  return unwrap<QuestionSummary[]>(await res.json(), `GET ${url}`);
}

/**
 * Delete this spec's own questions if an earlier run was interrupted between creating and
 * deleting them. Only the two exact contents of this case are touched; the bank and every
 * other question stay out of reach, so a retry on the same tenant always starts from one
 * question.
 */
async function removeOwnQuestions(api: APIRequestContext, bankId: string): Promise<void> {
  const contents: string[] = [INITIAL.content, EDITED.content];
  for (const question of await listQuestions(api, bankId)) {
    if (!contents.includes(question.content)) continue;
    const res = await api.delete(`${QUESTIONS_URL}/${question.id}`);
    expect(res.ok(), `DELETE leftover question "${question.content}" → ${await res.text()}`).toBe(
      true,
    );
  }
}

async function createQuestion(
  api: APIRequestContext,
  bankId: string,
  topicId: string,
): Promise<QuestionSummary> {
  const res = await api.post(QUESTIONS_URL, {
    data: {
      bankId,
      type: 'mcq',
      content: INITIAL.content,
      explanation: INITIAL.explanation,
      topicIds: [topicId],
      answers: INITIAL.answers.map((content, orderIndex) => ({
        content,
        isCorrect: orderIndex === INITIAL.correctIndex,
        orderIndex,
      })),
    },
  });
  expect(res.status(), `POST ${QUESTIONS_URL} → ${await res.text()}`).toBe(201);
  return unwrap<QuestionSummary>(await res.json(), `POST ${QUESTIONS_URL}`);
}

async function getQuestion(api: APIRequestContext, id: string): Promise<QuestionSummary> {
  const res = await api.get(`${QUESTIONS_URL}/${id}`);
  expect(res.status(), `GET ${QUESTIONS_URL}/${id} → ${await res.text()}`).toBe(200);
  return unwrap<QuestionSummary>(await res.json(), `GET ${QUESTIONS_URL}/${id}`);
}

/** The table row whose question cell is exactly `content`. */
function questionRow(page: Page, content: string): Locator {
  return page
    .locator('table tbody tr')
    .filter({ has: page.getByRole('cell', { name: content, exact: true }) });
}

/** The answers column (Question / Type / Topics / Answers / Actions). */
function answersCell(row: Locator): Locator {
  return row.getByRole('cell').nth(3);
}

test.describe('@case:EDU-Q-05 @area:EDU @prio:P2 edit and delete a question', () => {
  test('changes the correct answer, then deletes the question with confirmation', async ({
    page,
  }) => {
    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    if (!tenant.org || !tenant.users.teacher) {
      throw new Error(`${CASE} needs the content tenant profile (org and educator)`);
    }

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await loginAs(page, tenant, 'teacher', { locale: 'pl', waitFor: /\/edu(\/|$)/ });
    expect(new URL(page.url()).pathname, 'the educator lands on /edu').toBe('/edu');

    // --- Prerequisite (EDU-Q-02): bank „Fizyka” + its multiple-choice question ---
    const bank = await ensureBank(page.request);
    const topic = await ensureTopic(page.request);
    await removeOwnQuestions(page.request, bank.id);
    const question = await createQuestion(page.request, bank.id, topic.id);
    expect(question.question_answers.filter((answer) => answer.is_correct)).toHaveLength(1);

    await page.goto(`/edu/questions/${bank.id}`);
    await expect(page).toHaveURL(new RegExp(`/edu/questions/${bank.id}$`));
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
    await expect(page.getByRole('heading', { name: BANK.name, exact: true })).toBeVisible();

    // --- Step 1a: the row is the case's question, authored by the educator -----
    const row = questionRow(page, INITIAL.content);
    await expect(row, 'the question is listed in the bank').toBeVisible();
    await expect(row).toContainText(COPY.mcqType);
    await expect(row).toContainText(TOPIC);
    await expect(answersCell(row)).toHaveText('4');
    await expect(row.getByRole('button', { name: COPY.edit })).toBeVisible();
    await expect(row.getByRole('button', { name: COPY.delete })).toBeVisible();

    // --- Step 1b: „Edytuj pytanie” is pre-filled with the stored question -----
    await row.getByRole('button', { name: COPY.edit }).click();
    const dialog = page.locator('[data-slot="dialog-content"]');
    await expect(dialog.getByRole('heading', { name: COPY.editTitle })).toBeVisible();
    await expect(dialog.getByText(COPY.editDescription, { exact: true })).toBeVisible();

    const contentInput = dialog.getByPlaceholder(COPY.questionPlaceholder);
    const explanationInput = dialog.getByPlaceholder(COPY.explanationPlaceholder);
    // The text inputs render without a `type` attribute, so they are addressed by
    // the placeholder the dialog gives each answer row.
    const answerInputs = dialog.locator('input[placeholder^="Odpowiedź"]');
    const radios = dialog.locator('input[type="radio"]');

    await expect(contentInput).toHaveValue(INITIAL.content);
    await expect(explanationInput).toHaveValue(INITIAL.explanation);
    await expect(answerInputs).toHaveCount(INITIAL.answers.length);
    for (const [index, answer] of INITIAL.answers.entries()) {
      await expect(
        dialog.getByPlaceholder(COPY.answerPlaceholder(index + 1)),
        `answer ${index + 1}`,
      ).toHaveValue(answer);
    }
    await expect(radios).toHaveCount(INITIAL.answers.length);
    for (let index = 0; index < INITIAL.answers.length; index++) {
      if (index === INITIAL.correctIndex) {
        await expect(radios.nth(index), 'the stored correct answer is checked').toBeChecked();
      } else {
        await expect(radios.nth(index), `answer ${index + 1} is not correct`).not.toBeChecked();
      }
    }
    // The topic multi-select renders as a `role="combobox"` button (the type `Select`
    // above it is the dialog's other combobox), carrying the stored topic as a badge.
    const topicPicker = dialog.getByRole('combobox').filter({ hasText: TOPIC });
    await expect(topicPicker, 'the stored topic is selected').toBeVisible();

    // --- Step 1c: change the correct answer (and the content it belongs to) ---
    await contentInput.fill(EDITED.content);
    await explanationInput.fill(EDITED.explanation);
    await radios.nth(EDITED.correctIndex).check();
    await expect(radios.nth(EDITED.correctIndex)).toBeChecked();
    await expect(
      radios.nth(INITIAL.correctIndex),
      'a radio group keeps exactly one correct answer',
    ).not.toBeChecked();

    await dialog.getByRole('button', { name: COPY.update, exact: true }).click();

    await expect(dialog, 'the dialog closes after saving').toBeHidden();
    await expect(
      page.locator('[data-sonner-toast]').filter({ hasText: COPY.updated }),
      'success toast after saving',
    ).toBeVisible();

    // --- Expected result: the row and the API carry the edited question --------
    const editedRow = questionRow(page, EDITED.content);
    await expect(editedRow, 'the row shows the edited content').toBeVisible();
    await expect(editedRow).toContainText(COPY.mcqType);
    await expect(editedRow).toContainText(TOPIC);
    await expect(answersCell(editedRow)).toHaveText('4');
    await expect(
      questionRow(page, INITIAL.content),
      'the old content is gone from the table',
    ).toHaveCount(0);

    const stored = await getQuestion(page.request, question.id);
    expect(stored.content, 'the edited content is stored').toBe(EDITED.content);
    expect(stored.explanation, 'the edited explanation is stored').toBe(EDITED.explanation);
    expect(
      stored.question_answers.map((answer) => answer.content).sort(),
      'the four answers survive the edit',
    ).toEqual([...INITIAL.answers].sort());
    const correct = stored.question_answers.filter((answer) => answer.is_correct);
    expect(correct, 'exactly one answer is correct after the edit').toHaveLength(1);
    expect(correct[0].content, 'the newly selected answer is the correct one').toBe(
      INITIAL.answers[EDITED.correctIndex],
    );
    expect(
      stored.topics?.map((storedTopic) => storedTopic.name),
      'the topic survives the edit',
    ).toEqual([TOPIC]);

    // --- Step 2a: „Usunąć pytanie?” carries the warning, „Anuluj” keeps it ----
    await editedRow.getByRole('button', { name: COPY.delete }).click();
    const deleteDialog = page.locator('[data-slot="dialog-content"]');
    await expect(
      deleteDialog.getByRole('heading', { name: COPY.deleteTitle }),
      'the confirmation window title from the case',
    ).toBeVisible();
    await expect(
      deleteDialog.getByText(COPY.deleteDescription, { exact: true }),
      'the permanent-delete warning',
    ).toBeVisible();

    await deleteDialog.getByRole('button', { name: COPY.cancel, exact: true }).click();
    await expect(deleteDialog, 'the cancelled delete closes the window').toBeHidden();
    await expect(editedRow, 'the cancelled delete keeps the row').toBeVisible();
    expect(
      (await page.request.get(`${QUESTIONS_URL}/${question.id}`)).status(),
      'the cancelled delete keeps the question in the API',
    ).toBe(200);

    // --- Step 2b: confirming removes the question ----------------------------
    await editedRow.getByRole('button', { name: COPY.delete }).click();
    await expect(deleteDialog).toBeVisible();
    await deleteDialog.getByRole('button', { name: COPY.delete, exact: true }).click();

    await expect(
      page.locator('[data-sonner-toast]').filter({ hasText: COPY.deleted }),
      'success toast after deleting',
    ).toBeVisible();
    await expect(editedRow, 'the deleted row is gone').toHaveCount(0);
    await expect(
      page.locator('table tbody'),
      'the bank falls back to its empty state',
    ).toContainText(COPY.emptyState);
    expect(
      (await page.request.get(`${QUESTIONS_URL}/${question.id}`)).status(),
      'the deleted question is gone from the API',
    ).toBe(404);

    expect(pageErrors, 'uncaught page errors during the walk').toEqual([]);
  });
});
