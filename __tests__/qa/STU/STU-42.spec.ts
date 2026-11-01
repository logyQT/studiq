import { expect, test, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * STU-42 — Statystyki, zakładka „Treści” (`/app/stats/content`).
 *
 * Prerequisite (reconciled with the tenant seeder): a signed-in student with a
 * study history (the case inherits it from STU-05). The legacy manual seed
 * (`student1@…`, password `pass`, CSV `fiszki_poprawne.csv`) is never used; the
 * case runs on its own tenant, seeded by the suite runner before every
 * independent run:
 *
 *   bun scripts/qa-tenant.ts STU-42 --fresh
 *
 * `__tests__/qa/profiles/STU-42.json` declares the default `content` profile: one
 * organization with a manager (org admin, never used), an educator and the
 * `student` account this case logs in as, plus the default group `G1`
 * (`tenantKey('qa/cases/STU-42.md', 'STU-42#<run>', 'qa-shared')` + `tenantId`
 * for every id). The profile seeds the graph only: the spec builds the study
 * history itself through the product API — a `STU-42 <run>` deck with four cards
 * (`Alfa`/`Bravo`/`Charlie`/`Echo <run>`) and the same practice rows a study
 * session writes (`POST /api/v1/flashcards/batch/practice`, the endpoint the
 * session client uses), so the stats page has exactly the fixture it asserts.
 * Nothing shared is read or written: no seed content, admin setting, feature
 * flag, plan or singleton row.
 *
 * CI seeds the tenant **once** for the whole case and Playwright reuses it for
 * every retry and every `--repeat-each` pass, so the test first deletes its own
 * `STU-42 …` decks (deleting a deck cascades its cards, their practice rows and
 * their review state), then rebuilds the fixture. Only this tenant's rows are
 * touched.
 *
 * Behaviour walked on the shared app before writing this spec:
 *
 * 1. `/app/stats` redirects to `/app/stats/content`, headed „Treści”.
 * 2. The four cards the case names — „Wszystkie fiszki”, „Przećwiczone”,
 *    „Śr. poprawność”, „Śr. łatwość” — plus the page's own „Nowe fiszki” card
 *    carry the numbers computed from the student's own cards: total, practiced
 *    cards, the mean of the per-card accuracy and the mean easiness factor.
 * 3. The state vocabulary the case lists (Nowa / W nauce / Powtórka / Poprawa /
 *    Oporne) is the table's state badge and the filter row
 *    (Wszystkie / Nowe / Do nauczenia / Do utrwalenia / Do przypomnienia /
 *    Oporne); filtering narrows the table to that state.
 * 4. The table has the case's columns (Stan, Przód, Próby, Poprawność, EF,
 *    Interwał) and a row expands into Pytanie / Odpowiedź / Powtórzenia /
 *    Krok nauki / Pomyłki / Ostatnia powtórka.
 * 5. „Data dodania”, „Próby”, „Poprawność” and „Łatwość” each re-sort the table
 *    descending, with the four fixture cards landing in a distinct order per
 *    sort key.
 *
 * The case's Expected block also lists „podział stanów” and „Najsłabsze talie” /
 * „Najsłabsze tematy”. Those sections live on the sibling stats page
 * `/app/stats/activity` (the „Aktywność” sidebar entry), which has its own case
 * STU-44; `/app/stats/content` owns the cards, the state filters and the table
 * asserted here. The navigation assertion keeps the split honest.
 */

const CASE = 'STU-42';
const DECKS_URL = '/api/v1/flashcards/decks';
const PRACTICE_URL = '/api/v1/flashcards/batch/practice';

/** Polish copy the case quotes; `locale: 'pl'` pins it for the run. */
const UI = {
  title: 'Treści',
  cards: {
    total: 'Wszystkie fiszki',
    practiced: 'Przećwiczone',
    accuracy: 'Śr. poprawność',
    easiness: 'Śr. łatwość',
    newCards: 'Nowe fiszki',
  },
  filters: {
    all: 'Wszystkie',
    new: 'Nowe',
    learning: 'Do nauczenia',
    review: 'Do utrwalenia',
    relearning: 'Do przypomnienia',
    leech: 'Oporne',
  },
  sorts: {
    date: 'Data dodania',
    attempts: 'Próby',
    accuracy: 'Poprawność',
    easiness: 'Łatwość',
  },
  columns: ['Stan', 'Przód', 'Próby', 'Poprawność', 'EF', 'Interwał'],
  stateNew: 'Nowa',
  stateReview: 'Powtórka',
  noCards: 'Nie znaleziono fiszek',
  emptyAttempts: '--',
} as const;

/** One fixture card: its front label, practices (correct first) and EF. */
const FIXTURE = [
  // 5 attempts, 4 correct → 80 %, EF 2.50 → 1.80 (four steps of −0.14, one −0.28).
  {
    label: 'Alfa',
    practices: [true, true, true, false, true],
    attempts: 5,
    accuracy: '80%',
    ef: '1.80',
    state: UI.stateReview,
  },
  // 2 attempts, 1 correct → 50 %, EF 2.22.
  {
    label: 'Bravo',
    practices: [true, false],
    attempts: 2,
    accuracy: '50%',
    ef: '2.22',
    state: UI.stateReview,
  },
  // 3 attempts, all correct → 100 %, EF 2.08.
  {
    label: 'Charlie',
    practices: [true, true, true],
    attempts: 3,
    accuracy: '100%',
    ef: '2.08',
    state: UI.stateReview,
  },
  // Never practiced → the „Nowa” state and no EF/interval yet.
  {
    label: 'Echo',
    practices: [],
    attempts: 0,
    accuracy: UI.emptyAttempts,
    ef: UI.emptyAttempts,
    state: UI.stateNew,
  },
] as const;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface Deck {
  id: string;
  name: string;
}

/** Value line of a `StatCard` (the title is its previous sibling `<p>`). */
function statValue(page: Page, title: string) {
  return page.getByText(title, { exact: true }).locator('xpath=following-sibling::p[1]');
}

/** A table row by its „Przód” cell — the expanded detail row has no second cell. */
function dataRow(page: Page, front: string) {
  return page
    .locator('tbody tr')
    .filter({ has: page.locator('td:nth-child(2)', { hasText: front }) });
}

/** The visible „Przód” column, in render order. */
function fronts(page: Page) {
  return page.locator('tbody tr td:nth-child(2)');
}

/**
 * Drop this case's own decks from an earlier pass on the CI-seeded tenant.
 * Deleting a deck cascades its cards, their practice rows and their review
 * state, so the rebuilt fixture is the only thing the page can show.
 */
async function clearRunState(page: Page): Promise<void> {
  const listResponse = await page.request.get(`${DECKS_URL}?limit=100`);
  expect(listResponse.status(), `GET ${DECKS_URL}`).toBe(200);
  const list = (await listResponse.json()) as ApiEnvelope<{ items: Deck[] }>;
  for (const deck of list.data.items.filter((item) => item.name.startsWith(`${CASE} `))) {
    const deleted = await page.request.delete(`${DECKS_URL}/${deck.id}`);
    expect(deleted.status(), `DELETE ${DECKS_URL}/${deck.id} (${deck.name})`).toBe(200);
  }
}

test.describe('STU-42 — student stats, content tab', () => {
  test('redirects to the content tab and reports cards, states and sortable study history', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const tenant: QaTenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} runs on the content profile`).toBe('content');
    expect(
      tenant.runSuffix,
      'seed with --fresh: every independent run owns a new tenant',
    ).toBeTruthy();
    const student = tenant.users.student;
    expect(student, `${CASE} seeds the student under test`).toBeTruthy();
    if (!student) throw new Error(`${CASE} tenant has no seeded student`);

    // Fixture names carry the run suffix, so two seeded tenants never collide.
    const run = tenant.runSuffix ?? tenant.key.slice(-6);
    const deckName = `${CASE} ${run}`;
    const frontsByLabel = new Map(
      FIXTURE.map((card) => [card.label, `${card.label} ${run}`] as const),
    );
    const frontOf = (label: string) => frontsByLabel.get(label)!;

    // ── Precondition: the tenant student, with a study history of its own ────
    await loginAs(page, tenant, 'student', { locale: 'pl' });
    await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });
    // A retry or a repeat pass reuses this tenant: drop what the previous pass left.
    await clearRunState(page);

    const deckResponse = await page.request.post(DECKS_URL, { data: { name: deckName } });
    expect(deckResponse.status(), `create deck ${deckName}`).toBe(201);
    const deckId = ((await deckResponse.json()) as ApiEnvelope<{ id: string }>).data.id;

    const cardIds = new Map<string, string>();
    for (const card of FIXTURE) {
      const created = await page.request.post('/api/v1/flashcards', {
        data: { deckId, front: frontOf(card.label), back: `Odpowiedz ${frontOf(card.label)}` },
      });
      expect(created.status(), `create card ${frontOf(card.label)}`).toBe(201);
      cardIds.set(card.label, ((await created.json()) as ApiEnvelope<{ id: string }>).data.id);
    }

    // The practice rows a study session writes, one request per card, in order.
    for (const card of FIXTURE) {
      if (card.practices.length === 0) continue;
      const practiced = await page.request.post(PRACTICE_URL, {
        data: {
          mode: 'review',
          items: card.practices.map((wasCorrect) => ({
            flashcardId: cardIds.get(card.label),
            wasCorrect,
          })),
        },
      });
      expect(practiced.status(), `practice ${frontOf(card.label)}`).toBe(200);
    }

    // ── Step 1: /app/stats redirects to the content tab ──────────────────────
    await page.goto('/app/stats');
    await expect(page).toHaveURL(/\/app\/stats\/content$/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { level: 1, name: UI.title })).toBeVisible();
    // The stats module is three sibling pages; „Treści” is the active one.
    const sidebarLink = (href: string) =>
      page.locator(`a[href="${href}"][data-slot="sidebar-menu-button"]`);
    for (const [href, label] of [
      ['/app/stats/content', 'Treści'],
      ['/app/stats/results', 'Wyniki'],
      ['/app/stats/activity', 'Aktywność'],
    ] as const) {
      await expect(sidebarLink(href)).toContainText(label);
    }
    await expect(sidebarLink('/app/stats/content')).toHaveAttribute('data-active', 'true');

    // ── Step 1b: the summary cards ───────────────────────────────────────────
    // 4 cards in total, 3 of them practiced, the mean of the per-card accuracy
    // (80 / 50 / 100 → 77 %) and of the easiness factor (1.80 / 2.22 / 2.08 → 2.03).
    await expect(statValue(page, UI.cards.total)).toHaveText(String(FIXTURE.length));
    await expect(statValue(page, UI.cards.practiced)).toHaveText('3');
    await expect(statValue(page, UI.cards.accuracy)).toHaveText('77%');
    await expect(statValue(page, UI.cards.easiness)).toHaveText('2.03');
    await expect(statValue(page, UI.cards.newCards)).toHaveText('1');

    // ── Step 1c: the state vocabulary — filter chips + table badges ──────────
    for (const label of Object.values(UI.filters)) {
      await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
    }
    for (const column of UI.columns) {
      await expect(
        page.locator('thead th').filter({ hasText: new RegExp(`^${column}$`) }),
      ).toBeVisible();
    }

    // ── Step 2: sorting by each of the case's four keys ──────────────────────
    const sortSelect = page.locator('select');
    for (const label of Object.values(UI.sorts)) {
      await expect(sortSelect.locator('option', { hasText: label })).toHaveCount(1);
    }

    // Default: „Data dodania”, newest first (created Alfa → Bravo → Charlie → Echo).
    await expect(sortSelect).toHaveValue('createdAt');
    await expect(fronts(page)).toHaveText([
      frontOf('Echo'),
      frontOf('Charlie'),
      frontOf('Bravo'),
      frontOf('Alfa'),
    ]);

    // „Próby” — most attempts first (5, 3, 2, 0).
    await sortSelect.selectOption('totalAttempts');
    await expect(fronts(page)).toHaveText([
      frontOf('Alfa'),
      frontOf('Charlie'),
      frontOf('Bravo'),
      frontOf('Echo'),
    ]);

    // „Poprawność” — highest accuracy first (100, 80, 50, none practiced).
    await sortSelect.selectOption('correctRate');
    await expect(fronts(page)).toHaveText([
      frontOf('Charlie'),
      frontOf('Alfa'),
      frontOf('Bravo'),
      frontOf('Echo'),
    ]);

    // „Łatwość” — highest easiness factor first (2.22, 2.08, 1.80, none yet).
    await sortSelect.selectOption('easinessFactor');
    await expect(fronts(page)).toHaveText([
      frontOf('Bravo'),
      frontOf('Charlie'),
      frontOf('Alfa'),
      frontOf('Echo'),
    ]);

    // ── Step 1d: the rows carry the per-card statistics ──────────────────────
    const alfa = dataRow(page, frontOf('Alfa'));
    await expect(alfa).toHaveCount(1);
    const alfaCells = alfa.locator('td');
    await expect(alfaCells.nth(0)).toHaveText(UI.stateReview);
    await expect(alfaCells.nth(1)).toHaveText(frontOf('Alfa'));
    await expect(alfaCells.nth(2)).toHaveText('5');
    await expect(alfaCells.nth(3)).toHaveText('80%');
    await expect(alfaCells.nth(4)).toHaveText('1.80');
    // The interval is load-balanced (a fuzzed day count), so only its presence counts.
    await expect(alfaCells.nth(5)).not.toHaveText(UI.emptyAttempts);

    const echo = dataRow(page, frontOf('Echo'));
    const echoCells = echo.locator('td');
    await expect(echoCells.nth(0)).toHaveText(UI.stateNew);
    await expect(echoCells.nth(2)).toHaveText('0');
    await expect(echoCells.nth(3)).toHaveText(UI.emptyAttempts);
    await expect(echoCells.nth(4)).toHaveText(UI.emptyAttempts);
    await expect(echoCells.nth(5)).toHaveText(UI.emptyAttempts);

    // ── Step 1e: a row expands into the case's details ───────────────────────
    await alfa.click();
    const detail = page.locator('tbody tr td[colspan]');
    await expect(detail).toHaveCount(1);
    for (const label of [
      'Pytanie',
      'Odpowiedź',
      'Powtórzenia',
      'Krok nauki',
      'Pomyłki',
      'Ostatnia powtórka',
    ]) {
      await expect(detail).toContainText(new RegExp(label, 'i'));
    }
    await expect(detail).toContainText(frontOf('Alfa'));
    await expect(detail).toContainText(`Odpowiedz ${frontOf('Alfa')}`);

    // Collapsing it brings the table back to one row per card.
    await alfa.click();
    await expect(detail).toHaveCount(0);
    await expect(fronts(page)).toHaveCount(FIXTURE.length);

    // ── Step 1f: the state filters narrow the table ──────────────────────────
    await page.getByRole('button', { name: UI.filters.new, exact: true }).click();
    await expect(fronts(page)).toHaveText([frontOf('Echo')]);

    await page.getByRole('button', { name: UI.filters.review, exact: true }).click();
    await expect(fronts(page)).toHaveCount(3);
    await expect(dataRow(page, frontOf('Echo'))).toHaveCount(0);

    // A state nobody is in falls back to the empty table.
    await page.getByRole('button', { name: UI.filters.learning, exact: true }).click();
    await expect(fronts(page)).toHaveCount(0);
    await expect(page.getByText(UI.noCards, { exact: true })).toBeVisible();

    await page.getByRole('button', { name: UI.filters.all, exact: true }).click();
    await expect(fronts(page)).toHaveCount(FIXTURE.length);
  });
});
