import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * STU-30 — the student's topics (`/app/topics`): create „Matematyka”, rename it,
 * delete it, and refuse an empty name.
 *
 * Case steps: click „Nowy Temat”, name it „Matematyka” and save; rename it to
 * „Matematyka 2”; delete it and confirm; try to create a topic with an empty name.
 * Expected: „Temat utworzony” / „Temat zaktualizowany” / „Temat usunięty”, a delete
 * dialog „Usunąć Temat?” — „To trwale usunie temat. Tej akcji nie można cofnąć.”,
 * and „Nazwa tematu jest wymagana” for the empty name.
 *
 * Tenant (deterministic, `content` profile, fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts STU-30 --fresh
 *
 * gives the org `qa-stu-30-<suffix>` with a manager, an educator and the student this
 * case signs in as — every id derived from `tenantKey('qa/cases/STU-30.md',
 * 'STU-30#<suffix>', 'qa-shared')` + `tenantId(key, entity)`. The legacy prerequisite
 * (`student1@dev.local`, password `pass`, the WSB Merito org) maps onto that student
 * (`member`, so `topic.read/create/update/delete` resolve for its own topics). The
 * spec reads the ids through `loadTenant('STU-30')`; nothing global is read or written
 * — no admin setting, feature flag, plan, platform stat or singleton row, and no other
 * tenant.
 *
 * The tenant starts empty, so every topic in this flow is created and removed by the
 * spec itself. Leftovers with the two deterministic names are deleted at the start of
 * each execution, so a CI retry on the same seeded tenant (`--retries=2`) starts from
 * the same empty list instead of depending on an earlier run.
 *
 * Acceptance points walked on the shared app (:3010, QA worker qa-env-5, 2026-10-29):
 * - `/app/topics` shows the „Moja Nauka › Menedżer Tematów” breadcrumb, the „Nowy Temat”
 *   toolbar button and, while empty, „Nic tutaj jeszcze nie ma, stwórz swój pierwszy
 *   temat!” plus a second „Nowy Temat” action.
 * - „Nowy Temat” opens „Utwórz Temat” / „Dodaj nowy temat fiszek” with an empty name
 *   field and the „Anuluj” / „Utwórz” buttons.
 * - Saving „Matematyka” shows the „Temat utworzony” toast, closes the dialog and adds a
 *   card with the „0 fiszek” badge, owned by the signed-in student.
 * - The card menu is „Więcej akcji: <nazwa>” with „Wybierz” / „Edytuj” / „Usuń”.
 *   „Edytuj” opens „Edytuj Temat” / „Zaktualizuj nazwę tematu” prefilled with the current
 *   name; saving „Matematyka 2” shows „Temat zaktualizowany”, closes the dialog and the
 *   card takes the new name (same topic id, still 0 flashcards).
 * - „Usuń” asks „Usunąć Temat?” / „To trwale usunie temat. Tej akcji nie można cofnąć.”;
 *   confirming shows „Temat usunięty”, closes the dialog, removes the card and the topic
 *   is gone from the API.
 * - Submitting an empty name shows „Nazwa tematu jest wymagana”, keeps the dialog open
 *   and creates nothing.
 */

const CASE = 'STU-30';

/** Polish copy from `AppFlashcardTopicsPage` / `Common` / `A11y` (pl.json). */
const COPY = {
  title: 'Menedżer Tematów',
  newTopic: 'Nowy Temat',
  createTitle: 'Utwórz Temat',
  createDesc: 'Dodaj nowy temat fiszek',
  editTitle: 'Edytuj Temat',
  editDesc: 'Zaktualizuj nazwę tematu',
  create: 'Utwórz',
  update: 'Aktualizuj',
  edit: 'Edytuj',
  remove: 'Usuń',
  nameRequired: 'Nazwa tematu jest wymagana',
  created: 'Temat utworzony',
  updated: 'Temat zaktualizowany',
  deleted: 'Temat usunięty',
  deleteTitle: 'Usunąć Temat?',
  deleteDesc: 'To trwale usunie temat. Tej akcji nie można cofnąć.',
  emptyList: 'Nic tutaj jeszcze nie ma, stwórz swój pierwszy temat!',
} as const;

/** The case's own topic and its renamed form. */
const TOPIC = 'Matematyka';
const RENAMED = 'Matematyka 2';

const TOPICS_URL = '/api/v1/flashcards/topics';

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error?: string;
}

interface TopicRow {
  id: string;
  name: string;
  created_by: string;
  visibility: 'personal' | 'group';
  flashcard_count: number;
}

/** `GET` an endpoint as the signed-in student and unwrap the response envelope. */
async function getData<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  expect(response.ok(), `GET ${url} → ${response.status()} ${await response.text()}`).toBe(true);
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(body.success, `GET ${url} success flag`).toBe(true);
  return body.data;
}

/** `GET /api/v1/flashcards/topics` — the same list the screen renders. */
async function listTopics(page: Page): Promise<TopicRow[]> {
  return (await getData<{ items: TopicRow[] }>(page, `${TOPICS_URL}?limit=50`)).items;
}

/** Delete this student's topics that carry one of the case's deterministic names. */
async function deleteCaseTopics(page: Page, ownerId: string): Promise<void> {
  const names = new Set([TOPIC, RENAMED]);
  for (const topic of (await listTopics(page)).filter(
    (row) => row.created_by === ownerId && names.has(row.name),
  )) {
    const response = await page.request.delete(`${TOPICS_URL}/${topic.id}`);
    expect(
      response.status(),
      `DELETE ${TOPICS_URL}/${topic.id} (${topic.name}) → ${await response.text()}`,
    ).toBe(200);
  }
}

/** The sonner toast carrying this text (success and validation share the region). */
function toast(page: Page, text: string): Locator {
  return page.locator('[data-sonner-toast]').filter({ hasText: text });
}

/** The card of the topic with this exact name (the title is the card's `h3`). */
function topicCard(page: Page, name: string): Locator {
  return page.locator('[data-slot="card"]').filter({
    has: page.getByRole('heading', { name, exact: true }),
  });
}

/** The card's „Więcej akcji: <name>” trigger (the mobile duplicate is `display:none`). */
function moreActions(page: Page, name: string): Locator {
  return topicCard(page, name).getByRole('button', { name: `Więcej akcji: ${name}` });
}

/** The dialog surface shared by the create/edit form and the delete confirmation. */
function dialog(page: Page): Locator {
  return page.locator('[data-slot="dialog-content"]');
}

/** Open „Nowy Temat” and return the form dialog. */
async function openCreateForm(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: COPY.newTopic, exact: true }).first().click();
  const form = dialog(page);
  await expect(form).toBeVisible();
  await expect(form.getByRole('heading', { name: COPY.createTitle })).toBeVisible();
  await expect(form.getByText(COPY.createDesc, { exact: true })).toBeVisible();
  return form;
}

test.describe('@case:STU-30 @area:STU @prio:P2 student topics CRUD', () => {
  test('creates, renames and deletes „Matematyka” and refuses an empty name', async ({ page }) => {
    test.setTimeout(120_000);

    const tenant: QaTenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    const student = tenant.users.student;
    if (!tenant.org || !student) {
      throw new Error(`${CASE} needs the content tenant profile (org and student account)`);
    }

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });
    expect(new URL(page.url()).pathname, 'the student lands on /app').toBe('/app');

    // Retry-safe start: this tenant is this case's own, and the case's two names are
    // the only rows it ever creates. Clearing leftovers keeps a CI retry deterministic.
    await deleteCaseTopics(page, student.id);
    expect(await listTopics(page), 'the tenant starts without this case’s topics').toEqual([]);

    // ── Step 0: the student's topics page ───────────────────────────────────
    await page.goto('/app/topics');
    await expect(page).toHaveURL(/\/app\/topics$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
    await expect(
      page.locator('[data-slot="breadcrumb"]').getByText(COPY.title, { exact: true }),
      'the topics breadcrumb',
    ).toBeVisible();
    await expect(page.getByRole('button', { name: COPY.newTopic }).first()).toBeVisible();
    // The tenant is empty, so the list renders its empty state.
    await expect(page.getByText(COPY.emptyList, { exact: true })).toBeVisible();

    // ── Step 1: create „Matematyka” ─────────────────────────────────────────
    const form = await openCreateForm(page);
    const nameInput = form.getByRole('textbox');
    await expect(nameInput, 'a new topic starts with an empty name').toHaveValue('');

    await nameInput.fill(TOPIC);
    await form.getByRole('button', { name: COPY.create, exact: true }).click();

    await expect(toast(page, COPY.created), 'the creation toast').toBeVisible();
    await expect(form, 'the form closes after saving').toBeHidden();

    const createdCard = topicCard(page, TOPIC);
    await expect(createdCard, 'the new topic is listed').toBeVisible();
    await expect(
      createdCard.locator('[data-slot="badge"]').first(),
      'a new topic has no flashcards',
    ).toHaveText(/^0\s+fisz/);

    const created = (await listTopics(page)).filter((topic) => topic.name === TOPIC);
    expect(created, 'exactly one „Matematyka” in the API').toHaveLength(1);
    expect(created[0].created_by, 'the signed-in student owns the topic').toBe(student.id);
    expect(created[0].flashcard_count).toBe(0);
    const topicId = created[0].id;

    // ── Step 2: rename to „Matematyka 2” ────────────────────────────────────
    await moreActions(page, TOPIC).click();
    await page.getByRole('menuitem', { name: COPY.edit, exact: true }).click();
    await expect(form).toBeVisible();
    await expect(form.getByRole('heading', { name: COPY.editTitle })).toBeVisible();
    await expect(form.getByText(COPY.editDesc, { exact: true })).toBeVisible();
    await expect(nameInput, 'the edit form starts from the current name').toHaveValue(TOPIC);

    await nameInput.fill(RENAMED);
    await form.getByRole('button', { name: COPY.update, exact: true }).click();

    await expect(toast(page, COPY.updated), 'the update toast').toBeVisible();
    await expect(form, 'the form closes after saving').toBeHidden();
    await expect(topicCard(page, RENAMED), 'the card carries the new name').toBeVisible();
    await expect(topicCard(page, TOPIC), 'the old name is gone').toHaveCount(0);

    const renamed = (await listTopics(page)).filter((topic) => topic.name === RENAMED);
    expect(renamed, 'the API stores the renamed topic').toHaveLength(1);
    expect(renamed[0].id, 'the rename keeps the same topic').toBe(topicId);
    expect(renamed[0].flashcard_count, 'the rename keeps the flashcard count').toBe(0);

    // ── Step 3: delete „Matematyka 2” ───────────────────────────────────────
    await moreActions(page, RENAMED).click();
    await page.getByRole('menuitem', { name: COPY.remove, exact: true }).click();

    const confirm = dialog(page);
    await expect(confirm.getByRole('heading', { name: COPY.deleteTitle })).toBeVisible();
    await expect(confirm.getByText(COPY.deleteDesc, { exact: true })).toBeVisible();
    await confirm.getByRole('button', { name: COPY.remove, exact: true }).click();

    await expect(toast(page, COPY.deleted), 'the deletion toast').toBeVisible();
    await expect(confirm, 'the confirmation closes after deleting').toBeHidden();
    await expect(topicCard(page, RENAMED), 'the deleted topic leaves the list').toHaveCount(0);
    await expect(page.getByText(COPY.emptyList, { exact: true })).toBeVisible();
    expect(
      (await listTopics(page)).map((topic) => topic.name),
      'the API no longer returns the deleted topic',
    ).not.toContain(RENAMED);

    // ── Step 4: an empty name is refused ────────────────────────────────────
    const emptyForm = await openCreateForm(page);
    const emptyInput = emptyForm.getByRole('textbox');
    await expect(emptyInput).toHaveValue('');
    await emptyForm.getByRole('button', { name: COPY.create, exact: true }).click();

    await expect(toast(page, COPY.nameRequired), 'the empty-name validation toast').toBeVisible();
    await expect(emptyForm, 'the dialog stays open after the validation error').toBeVisible();
    expect(await emptyInput.inputValue(), 'the name is still empty').toBe('');
    expect(await listTopics(page), 'the empty submit created no topic').toEqual([]);

    // The dialog is still usable: cancelling leaves the list untouched.
    await emptyForm.getByRole('button', { name: 'Anuluj', exact: true }).click();
    await expect(emptyForm).toBeHidden();
    await expect(page.getByText(COPY.emptyList, { exact: true })).toBeVisible();

    expect(pageErrors, 'uncaught page errors on /app/topics').toEqual([]);
  });
});
