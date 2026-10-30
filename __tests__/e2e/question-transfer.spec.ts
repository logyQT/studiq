import { readFileSync } from 'node:fs';
import type { Download, Page } from '@playwright/test';
import { expect, test } from '#test/e2e/fixtures/tenant';
import { sidebarLink, t } from '#test/e2e/utils';

/**
 * Question bank import / export (#652). The promises this file guards:
 *
 * - an export imports back into a new bank unchanged (content, explanation, topics,
 *   answers and the answer key), in both formats;
 * - the CSV download starts with a UTF-8 BOM so Excel renders Polish characters — reading
 *   the body with `res.text()` instead of `res.blob()` strips the BOM (P1 regression);
 * - a file whose `correct` column points at a missing answer is rejected row by row and
 *   writes nothing;
 * - an import into a bank owned by an organisation keeps the questions in that
 *   organisation, not in the organisation the caller happened to have active (P2 regression).
 *   That mismatch is unreachable from the screens (`useOrgs` auto-selects an org, and a
 *   bank outside the active org is 404), so the last test asserts it at the API layer
 *   the screens call.
 */

const newBankButton = t('QuestionBankManagement.new_bank');
const editItem = t('Common.common_edit');
const deleteItem = t('Common.common_delete');
const deleteBankTitle = t('QuestionBankManagement.delete_title');
const bankDeleted = t('QuestionBankManagement.bank_deleted');
const createButton = t('Common.common_create');
const cancelButton = t('Common.common_cancel');

const MENU_LABEL = t('QuestionTransfer.menu_label');
const IMPORT_ACTION = t('QuestionTransfer.import_action');
const IMPORT_TITLE = t('QuestionTransfer.import_title');
const IMPORT_BUTTON = t('QuestionTransfer.import_button');
const EXPORT_CSV = t('QuestionTransfer.export_csv');
const EXPORT_JSON = t('QuestionTransfer.export_json');
const PROBLEMS_TITLE = t('QuestionTransfer.problems_title');
const PROBLEM_CORRECT = t('QuestionTransfer.problem_correct');
const PROBLEM_ANSWERS = t('QuestionTransfer.problem_answers');

const TOPIC = 'Geografia';
const MCQ = {
  type: 'mcq' as const,
  content: 'Które miasto jest stolicą Polski?',
  explanation: 'Warszawa jest stolicą Polski od 1596 roku.',
  answers: [
    { content: 'Kraków', isCorrect: false },
    { content: 'Gdańsk', isCorrect: false },
    { content: 'Warszawa', isCorrect: true },
  ],
};
const TF = {
  type: 'true_false' as const,
  content: 'Wisła wpada do Morza Bałtyckiego.',
  answers: [
    { content: 'Prawda', isCorrect: true },
    { content: 'Fałsz', isCorrect: false },
  ],
};
const OPEN = {
  type: 'open' as const,
  content: 'Opisz, czym jest fotosynteza.',
  answers: [],
};
/** The three questions both round-trip tests seed, in export order. */
const ROUND_TRIP_QUESTIONS = [MCQ, TF, OPEN];

const ANSWER_COLUMNS = 10;

function stamp() {
  return `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
}

function uniqueBankName(prefix: string) {
  return `QA669 ${prefix} ${stamp()}`;
}

// The card renders both the mobile and the desktop layout; only one is visible per viewport.
function visibleBankName(page: Page, name: string) {
  return page.getByText(name, { exact: true }).filter({ visible: true }).first();
}

function cardFor(page: Page, name: string) {
  return page.locator('.group').filter({ hasText: name }).first();
}

function cardMenuTrigger(page: Page, name: string) {
  return cardFor(page, name)
    .locator('button')
    .filter({ has: page.locator('svg.lucide-ellipsis-vertical') })
    .filter({ visible: true })
    .first();
}

// Client-side navigation from the already-hydrated dashboard (as other edu specs do):
// a full page load right after login can still remount the screen and drop dialog state.
async function openBanksPage(page: Page) {
  await sidebarLink(page, 'DashboardLayout.edu_questions').click();
  await page.waitForURL(/\/edu\/questions/);
  await expect(page.getByRole('button', { name: newBankButton }).first()).toBeVisible();
}

async function createBank(page: Page, name: string) {
  await page.getByRole('button', { name: newBankButton }).first().click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: newBankButton })).toBeVisible();

  await page.locator('#bank-name').fill(name);
  await dialog.getByRole('button', { name: createButton }).click();

  await expect(dialog).not.toBeVisible();
  await expect(visibleBankName(page, name)).toBeVisible({ timeout: 10_000 });
}

async function deleteBankFromMenu(page: Page, name: string) {
  await cardFor(page, name).hover();
  await cardMenuTrigger(page, name).click();
  await page.getByRole('menuitem', { name: deleteItem }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: deleteBankTitle })).toBeVisible();
  await dialog.getByRole('button', { name: deleteItem }).click();

  await expect(page.getByText(bankDeleted).first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText(name, { exact: true })).toHaveCount(0);
}

/** Opens a bank card, waits for the transfer menu and returns the bank's id. */
async function openBank(page: Page, name: string): Promise<string> {
  await cardFor(page, name).click({ position: { x: 24, y: 24 } });
  await expect(page).toHaveURL(/\/edu\/questions\/[0-9a-f-]{36}/);
  await expect(page.getByRole('button', { name: MENU_LABEL })).toBeVisible();
  return page.url().split('/').pop() as string;
}

async function deleteBank(page: Page, name: string) {
  await openBanksPage(page);
  await deleteBankFromMenu(page, name);
}

/* ------------------------------------------------------------------ fixtures */

interface CsvQuestion {
  type: string;
  content: string;
  explanation?: string;
  topics?: string[];
  answers?: Array<{ content: string; isCorrect?: boolean }>;
  /** Raw `correct` cell, used to build a file whose pointer is wrong. */
  correct?: string;
}

function csvCell(value: string) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Builds the documented layout with an independent writer, so a bug in the app cannot hide. */
function csvBody(questions: CsvQuestion[]) {
  const header = [
    'type',
    'content',
    'explanation',
    'topics',
    ...Array.from({ length: ANSWER_COLUMNS }, (_, i) => `answer_${i + 1}`),
    'correct',
  ];
  const rows = questions.map((question) => {
    const answers = Array.from(
      { length: ANSWER_COLUMNS },
      (_, i) => question.answers?.[i]?.content ?? '',
    );
    const correct =
      question.correct ??
      (question.answers ?? [])
        .map((answer, i) => (answer.isCorrect ? String(i + 1) : ''))
        .filter(Boolean)
        .join(';');
    return [
      question.type,
      question.content,
      question.explanation ?? '',
      (question.topics ?? []).join(';'),
      ...answers,
      correct,
    ];
  });
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
}

/** A CSV upload the way an export (or the template) arrives: the UTF-8 BOM is included. */
function csvUpload(name: string, questions: CsvQuestion[]) {
  return {
    name,
    mimeType: 'text/csv',
    buffer: Buffer.from(`\uFEFF${csvBody(questions)}`, 'utf8'),
  };
}

/* ------------------------------------------------------------ transfer actions */

async function openTransferMenu(page: Page) {
  await page.getByRole('button', { name: MENU_LABEL }).click();
}

/** Opens the import dialog and loads a file into it. */
async function chooseFile(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  await openTransferMenu(page);
  await page.getByRole('menuitem', { name: IMPORT_ACTION }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: IMPORT_TITLE })).toBeVisible();
  await dialog.getByTestId('question-import-file').setInputFiles(file);
  return dialog;
}

/** Loads a downloaded file from disk back into a fresh import dialog. */
async function chooseDownload(page: Page, download: Download, mimeType: string) {
  const path = await download.path();
  if (!path) throw new Error('download has no local path');
  return chooseFile(page, {
    name: download.suggestedFilename(),
    mimeType,
    buffer: readFileSync(path),
  });
}

async function exportFile(page: Page, item: RegExp): Promise<Download> {
  const nextDownload = page.waitForEvent('download');
  await openTransferMenu(page);
  await page.getByRole('menuitem', { name: item }).click();
  return nextDownload;
}

/* ---------------------------------------------------------------- api seeding */

interface SeedQuestion {
  type: 'mcq' | 'true_false' | 'open';
  content: string;
  explanation?: string;
  answers?: Array<{ content: string; isCorrect: boolean }>;
  topicIds?: string[];
}

async function seedTopic(page: Page, name: string): Promise<string> {
  const response = await page.request.post('/api/v1/topics', {
    data: { name },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as { data: { id: string } }).data.id;
}

/**
 * Creates questions through the normal endpoint, so an export is exercised on content
 * that never went through the transfer code.
 */
async function seedQuestions(page: Page, bankId: string, questions: SeedQuestion[]) {
  for (const question of questions) {
    const response = await page.request.post('/api/v1/questions', {
      data: {
        bankId,
        type: question.type,
        content: question.content,
        ...(question.explanation ? { explanation: question.explanation } : {}),
        topicIds: question.topicIds ?? [],
        answers: (question.answers ?? []).map((answer, orderIndex) => ({
          ...answer,
          orderIndex,
        })),
      },
    });
    expect(response.status(), await response.text()).toBe(201);
  }
}

function questionRow(page: Page, content: string) {
  return page.locator('tbody tr').filter({ hasText: content });
}

async function openQuestionEditor(page: Page, content: string) {
  await questionRow(page, content).getByRole('button', { name: editItem }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: t('QuestionForm.edit_title') })).toBeVisible();
  return dialog;
}

/* --------------------------------------------------------------------- tests */

test.describe('Question bank transfer', () => {
  test('A CSV export downloads a BOM-prefixed file with an ASCII name', async ({
    page,
    loginAs,
  }) => {
    const name = `QA669 Ćwiczenia Łódź ${stamp()}`;
    const stampInName = name.split(' ').pop() as string;
    const content = 'Ćwiczenia z języka polskiego – zażółć gęślą jaźń?';
    const explanation = 'Wyjaśnienie z ą, ć, ę, ł, ń, ó, ś, ź, ż.';

    await loginAs('teacher');
    await openBanksPage(page);
    await createBank(page, name);
    await openBank(page, name);

    const dialog = await chooseFile(
      page,
      csvUpload('polish.csv', [
        {
          type: 'mcq',
          content,
          explanation,
          topics: [TOPIC],
          answers: [
            { content: 'Odpowiedź ą', isCorrect: false },
            { content: 'Odpowiedź ę', isCorrect: true },
          ],
        },
      ]),
    );
    await expect(dialog.getByText(content, { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: IMPORT_BUTTON }).click();
    await expect(dialog).not.toBeVisible();
    await expect(questionRow(page, content)).toBeVisible({ timeout: 10_000 });

    // P1 regression: the client used to read the body with `res.text()`, which decodes
    // UTF-8 and drops the BOM, so Excel showed mojibake for Polish characters.
    const download = await exportFile(page, EXPORT_CSV);
    const path = await download.path();
    if (!path) throw new Error('download has no local path');
    const bytes = readFileSync(path);

    expect(download.suggestedFilename()).toBe(`questions-qa669-cwiczenia-lodz-${stampInName}.csv`);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);

    const text = bytes.toString('utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain(content);
    expect(text).toContain(explanation);

    await deleteBank(page, name);
  });

  test('A CSV export imports into a new bank unchanged', async ({ page, loginAs }) => {
    const source = uniqueBankName('CSV source');
    const target = uniqueBankName('CSV target');

    await loginAs('teacher');
    await openBanksPage(page);

    await createBank(page, source);
    const sourceId = await openBank(page, source);
    const topicId = await seedTopic(page, TOPIC);
    await seedQuestions(page, sourceId, [
      { ...MCQ, topicIds: [topicId] },
      { ...TF, topicIds: [topicId] },
      { ...OPEN, topicIds: [] },
    ]);
    await page.reload();
    await expect(questionRow(page, MCQ.content)).toBeVisible();

    const download = await exportFile(page, EXPORT_CSV);
    expect(download.suggestedFilename()).toBe(
      `questions-${source
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')}.csv`,
    );

    await deleteBank(page, source);
    await createBank(page, target);
    await openBank(page, target);

    const dialog = await chooseDownload(page, download, 'text/csv');
    // Preview maps the file before anything is written: contents, type labels and the
    // number of answer columns the `correct` cell points into.
    await expect(dialog.getByText(MCQ.content, { exact: true })).toBeVisible();
    await expect(dialog.getByText(OPEN.content, { exact: true })).toBeVisible();
    const mcqPreview = dialog.getByRole('row').filter({ hasText: MCQ.content });
    await expect(mcqPreview).toContainText(t('QuestionTransfer.type_mcq'));
    await expect(mcqPreview.getByRole('cell').nth(2)).toHaveText(String(MCQ.answers.length));

    await dialog.getByRole('button', { name: IMPORT_BUTTON }).click();
    await expect(dialog).not.toBeVisible();

    // Same texts back in the bank: content, type, topics and answer count.
    await expect(questionRow(page, MCQ.content)).toBeVisible({
      timeout: 10_000,
    });
    await expect(questionRow(page, MCQ.content)).toContainText(t('QuestionBankDetail.mcq'));
    await expect(questionRow(page, MCQ.content)).toContainText(TOPIC);
    await expect(questionRow(page, MCQ.content).getByRole('cell').nth(3)).toHaveText(
      String(MCQ.answers.length),
    );
    await expect(questionRow(page, TF.content)).toContainText(
      t('QuestionBankDetail.true_false_label'),
    );
    await expect(questionRow(page, OPEN.content).getByRole('cell').nth(3)).toHaveText('0');

    // The answer key survives: third option is still the right one, order and explanation too.
    const editor = await openQuestionEditor(page, MCQ.content);
    const textareas = editor.locator('textarea');
    await expect(textareas.nth(0)).toHaveValue(MCQ.content);
    await expect(textareas.nth(1)).toHaveValue(MCQ.explanation);
    const radios = editor.locator('input[type="radio"]');
    await expect(radios).toHaveCount(MCQ.answers.length);
    await expect(radios.nth(2)).toBeChecked();
    await expect(radios.nth(0)).not.toBeChecked();
    const answerInputs = editor.locator('input:not([type="radio"])');
    await expect(answerInputs.nth(0)).toHaveValue(MCQ.answers[0].content);
    await expect(answerInputs.nth(1)).toHaveValue(MCQ.answers[1].content);
    await expect(answerInputs.nth(2)).toHaveValue(MCQ.answers[2].content);
    await expect(editor.getByRole('combobox').filter({ hasText: TOPIC })).toBeVisible();
    await editor.getByRole('button', { name: cancelButton }).click();
    await expect(editor).not.toBeVisible();

    await deleteBank(page, target);
  });

  test('A JSON export imports into a new bank unchanged', async ({ page, loginAs }) => {
    const source = uniqueBankName('JSON source');
    const target = uniqueBankName('JSON target');

    await loginAs('teacher');
    await openBanksPage(page);

    await createBank(page, source);
    const sourceId = await openBank(page, source);
    const topicId = await seedTopic(page, TOPIC);
    await seedQuestions(page, sourceId, [
      { ...MCQ, topicIds: [topicId] },
      { ...TF, topicIds: [topicId] },
      { ...OPEN, topicIds: [] },
    ]);
    await page.reload();
    await expect(questionRow(page, MCQ.content)).toBeVisible();

    const download = await exportFile(page, EXPORT_JSON);
    expect(download.suggestedFilename()).toMatch(/^questions-.+\.json$/);

    await deleteBank(page, source);
    await createBank(page, target);
    await openBank(page, target);

    const dialog = await chooseDownload(page, download, 'application/json');
    await expect(dialog.getByText(TF.content, { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: IMPORT_BUTTON }).click();
    await expect(dialog).not.toBeVisible();

    await expect(questionRow(page, OPEN.content)).toBeVisible({
      timeout: 10_000,
    });
    for (const question of ROUND_TRIP_QUESTIONS) {
      await expect(questionRow(page, question.content)).toHaveCount(1);
      await expect(questionRow(page, question.content).getByRole('cell').nth(3)).toHaveText(
        String(question.answers.length),
      );
    }
    // Topics arrive from the JSON `topics` array, not from a CSV `topics` cell.
    await expect(questionRow(page, MCQ.content)).toContainText(TOPIC);

    const editor = await openQuestionEditor(page, MCQ.content);
    await expect(editor.locator('textarea').nth(1)).toHaveValue(MCQ.explanation);
    await expect(editor.locator('input[type="radio"]').nth(2)).toBeChecked();
    await editor.getByRole('button', { name: cancelButton }).click();
    await expect(editor).not.toBeVisible();

    await deleteBank(page, target);
  });

  test('A `correct` cell pointing at a missing answer blocks the import and writes nothing', async ({
    page,
    loginAs,
  }) => {
    const name = uniqueBankName('Validation');
    const validContent = 'Pytanie, które nie może zostać zapisane mimo poprawności.';
    const brokenContent = 'Pytanie z kluczem odpowiedzi poza zakresem.';

    await loginAs('teacher');
    await openBanksPage(page);
    await createBank(page, name);
    await openBank(page, name);

    const dialog = await chooseFile(
      page,
      csvUpload('broken.csv', [
        {
          type: 'mcq',
          content: validContent,
          answers: [{ content: 'A' }, { content: 'B', isCorrect: true }],
        },
        {
          type: 'mcq',
          content: brokenContent,
          answers: [{ content: 'A' }, { content: 'B' }, { content: 'C' }],
          // Answer column 4 is empty: the importer must report it instead of guessing.
          correct: '4',
        },
      ]),
    );

    await expect(dialog.getByText(PROBLEMS_TITLE)).toBeVisible();
    await expect(dialog.getByText(PROBLEM_CORRECT)).toBeVisible();
    await expect(dialog.getByText(PROBLEM_ANSWERS)).toBeVisible();
    // Even the valid row stays out: the file is all-or-nothing.
    await expect(dialog.getByRole('table')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: IMPORT_BUTTON })).toBeDisabled();

    await dialog.getByRole('button', { name: t('QuestionTransfer.cancel') }).click();
    await expect(dialog).not.toBeVisible();

    // Nothing was written, not even the row that could have been imported.
    await expect(page.getByText(t('QuestionBankDetail.no_questions'))).toBeVisible();
    await expect(page.getByText(validContent, { exact: true })).toHaveCount(0);
    await expect(page.getByText(brokenContent, { exact: true })).toHaveCount(0);

    await deleteBank(page, name);
  });

  test('The export flags questions an import would reject', async ({ page, loginAs }) => {
    const name = uniqueBankName('Warning');

    await loginAs('teacher');
    await openBanksPage(page);
    await createBank(page, name);
    const bankId = await openBank(page, name);

    // More options than a CSV has answer columns: the export ships it, but an import
    // must refuse it — the count travels in `X-Studiq-Not-Reimportable`.
    await seedQuestions(page, bankId, [
      {
        type: 'mcq',
        content: 'Pytanie z jedenastoma odpowiedziami.',
        answers: Array.from({ length: ANSWER_COLUMNS + 1 }, (_, i) => ({
          content: `Opcja ${i + 1}`,
          isCorrect: i === 0,
        })),
      },
    ]);
    await page.reload();
    await expect(questionRow(page, 'Pytanie z jedenastoma odpowiedziami.')).toBeVisible();

    const exported = page.waitForResponse(
      (response) =>
        response.url().includes('/export?format=csv') && response.request().method() === 'GET',
    );
    const nextDownload = page.waitForEvent('download');
    await openTransferMenu(page);
    await page.getByRole('menuitem', { name: EXPORT_CSV }).click();

    const response = await exported;
    expect(response.status()).toBe(200);
    expect(response.headers()['x-studiq-not-reimportable']).toBe('1');
    expect((await nextDownload).suggestedFilename()).toMatch(/^questions-.+\.csv$/);

    await deleteBank(page, name);
  });

  test('An import without an active organisation stays in the bank', async ({
    page,
    tenant,
    loginAs,
  }) => {
    const name = uniqueBankName('Tenant');
    const content = 'Pytanie zaimportowane bez aktywnej organizacji.';

    await loginAs('teacher');
    await openBanksPage(page);
    await createBank(page, name);
    const bankId = await openBank(page, name);
    const host = new URL(page.url()).hostname;

    // The UI cannot produce this mismatch: `useOrgs` auto-selects the first membership
    // as soon as the hint is missing, and a bank outside the active org is 404 for an
    // `own`-scoped role. The API still accepts the request (the caller authored the
    // bank), so the tenant rule is asserted where it is reachable: the cookie is
    // dropped for exactly this request, as a session without the hint would send it.
    await page.context().clearCookies({ name: 'active_org_id' });

    // P2 regression: taking the tenant from the context writes these rows with no
    // organisation, which hides them from the bank as soon as the org is active again.
    const imported = await page.request.post(`/api/v1/questions/banks/${bankId}/import`, {
      data: {
        questions: [
          {
            type: 'mcq',
            content,
            topics: [],
            answers: [
              { content: 'Tak', isCorrect: false },
              { content: 'Nie', isCorrect: true },
            ],
          },
        ],
      },
    });
    expect(imported.status(), await imported.text()).toBe(201);
    expect(((await imported.json()) as { data: { imported: number } }).data.imported).toBe(1);

    await page
      .context()
      .addCookies([
        { name: 'active_org_id', value: tenant.org.id, domain: host, path: '/', httpOnly: true },
      ]);

    // The rows follow the bank's tenant, so the bank still lists what was imported.
    const listed = await page.request.get(`/api/v1/questions?bankId=${bankId}&page=1&limit=25`);
    expect(listed.status(), await listed.text()).toBe(200);
    const page1 = (await listed.json()) as {
      data: { items: Array<{ content: string }>; total: number };
    };
    expect(page1.data.items.map((item) => item.content)).toEqual([content]);
    expect(page1.data.total).toBe(1);

    // The same rows in the bank's own screen.
    await page.goto(`/edu/questions/${bankId}`);
    await expect(questionRow(page, content)).toBeVisible({ timeout: 10_000 });

    await deleteBank(page, name);
  });
});
