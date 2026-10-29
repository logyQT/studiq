import { expect, test, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaRole, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * NFR-07 — browser console and server errors.
 *
 * Case: during the whole test run the tester keeps Console and Network open and
 * collects red errors, hydration warnings and 5xx responses. Expected result: no
 * 5xx responses on correct use and no unhandled exceptions.
 *
 * A single case cannot replay „all testing”, so this spec encodes a cross-module
 * smoke journey — public pages, then the student, educator and manager panels —
 * and watches Console/Network while a tester walks it. Every page is loaded as a
 * full document (not an in-app click) so server rendering, hydration and the
 * page's own data requests all run; the user menu is also opened and closed to
 * cover a client-only portal interaction.
 *
 * Tenant (deterministic, `content` profile, one run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts NFR-07 --fresh
 *
 * gives the org `qa-nfr-07-<suffix>` with a manager, an educator and a student
 * (`tenantKey('qa/cases/NFR-07.md', 'NFR-07#<suffix>', 'qa-shared')` +
 * `tenantId(key, entity)`). All ids and credentials come from
 * `loadTenant('NFR-07')`; the student's deck is created through the product API
 * inside this tenant and replaced on every run, so a reused tenant stays clean.
 * Nothing global is touched: no admin setting, feature flag, plan catalogue,
 * platform stat or singleton row.
 *
 * What is asserted (the case's acceptance criteria):
 * 1. no HTTP response with status >= 500 anywhere in the journey;
 * 2. no uncaught exception (`pageerror`);
 * 3. no `console.error` record (the case's „red errors”, which also surface React
 *    hydration mismatches and next-intl missing-message problems in the dev build
 *    the suite runs against).
 *
 * Scope notes from the walk:
 * - „Hydration warnings” are collected through the same `console.error` channel;
 *   the shared app logs none on this journey. Warnings (e.g. Radix' missing
 *   `Description` warning) are not errors and are not asserted here — the case
 *   asks to report red errors and 5xx, not every warning.
 * - 4xx responses are deliberately not failures: the case only forbids 5xx on
 *   correct use, and the walk produced none either.
 * - The live-study screen (`/app/study/live`) is the intentional „soon” screen
 *   and renders its heading without errors, so it is included as a normal page.
 */

const CASE = 'NFR-07';

const DECKS_URL = '/api/v1/flashcards/decks';
const BULK_CREATE_URL = '/api/v1/flashcards/batch/create';
/** Deck owned by this spec inside its own tenant; replaced on every run. */
const DECK_NAME = `${CASE} console smoke`;
const DECK_CARDS = 3;

const STUDENT_PAGES = [
  '/app',
  '/app/flashcards',
  '/app/study/learn',
  '/app/study/cram',
  '/app/study/quiz',
  '/app/study/live',
  '/app/topics',
  '/app/questions',
  '/app/assignments',
  '/app/reports',
  '/app/stats/content',
  '/app/stats/results',
  '/app/stats/activity',
] as const;

const TEACHER_PAGES = [
  '/edu',
  '/edu/flashcards',
  '/edu/topics',
  '/edu/questions',
  '/edu/quizzes',
  '/edu/assignments',
  '/edu/reports',
  '/edu/stats/data',
  '/edu/stats/results',
  '/edu/stats/activity',
] as const;

const MANAGER_PAGES = [
  '/manage',
  '/manage/members',
  '/manage/invites',
  '/manage/groups',
  '/manage/reports',
  '/manage/roles',
  '/manage/seats',
  '/manage/settings',
] as const;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface Deck {
  id: string;
  name: string;
}

/**
 * Console/Network recorder for one test. `problems` keeps one entry per distinct
 * symptom with its hit count, so a failing assertion names every bad response or
 * message instead of only the first one.
 */
class ConsoleNetworkMonitor {
  private readonly counts = new Map<string, number>();

  constructor(private readonly page: Page) {
    page.on('pageerror', (error) => {
      this.record(`uncaught exception: ${error.message}`);
    });
    page.on('console', (message) => {
      if (message.type() === 'error') this.record(`console.error: ${message.text()}`);
    });
    page.on('response', (response) => {
      if (response.status() >= 500) {
        this.record(`HTTP ${response.status()} ${response.request().method()} ${response.url()}`);
      }
    });
  }

  private record(problem: string): void {
    this.counts.set(problem, (this.counts.get(problem) ?? 0) + 1);
  }

  /** A readable list of every distinct problem, with the number of occurrences. */
  get problems(): string[] {
    return [...this.counts].map(([problem, count]) => `${problem} (×${count})`);
  }
}

function user(tenant: QaTenant, role: QaRole): { id: string; email: string; password: string } {
  const account = tenant.users[role];
  if (!account) {
    throw new Error(
      `${CASE} tenant has no ${role} user — seed it with: bun scripts/qa-tenant.ts ${CASE} --fresh`,
    );
  }
  return account;
}

/** Load `path` as a full document and wait for the authenticated shell to render. */
async function visit(page: Page, path: string): Promise<void> {
  const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
  expect(response?.status() ?? 0, `GET ${path} document status`).toBeLessThan(500);
  // The panel shell only exists behind the session; a silent redirect to /login
  // would otherwise make the page look harmless.
  await expect(page.locator('a[data-sidebar="menu-button"]').first()).toBeVisible();
  await expect(page).not.toHaveURL(/\/login/);
  // Let the page's own data requests land inside the monitored window.
  await page.waitForTimeout(700);
}

/** Load a public page (no sidebar) and let hydration finish. */
async function visitPublic(page: Page, path: string, marker: string): Promise<void> {
  const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
  expect(response?.status() ?? 0, `GET ${path} document status`).toBeLessThan(500);
  await expect(page.locator(marker).first()).toBeVisible();
  await page.waitForTimeout(700);
}

/** The user menu trigger is the sidebar button that carries the account e-mail. */
async function openUserMenu(page: Page, email: string): Promise<void> {
  const trigger = page
    .locator('button[data-slot="dropdown-menu-trigger"]')
    .filter({ hasText: email });
  // Radix toggles on click, so only click when it is closed.
  if ((await trigger.getAttribute('data-state')) !== 'open') {
    await trigger.click();
  }
  await expect(page.getByRole('menu')).toBeVisible();
}

/** Open the e-mail menu and close it again — a client-only portal interaction. */
async function exerciseUserMenu(page: Page, tenant: QaTenant, role: QaRole): Promise<void> {
  await openUserMenu(page, user(tenant, role).email);
  await expect(page.getByRole('menuitem').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
}

/**
 * Recreate this spec's deck with `DECK_CARDS` flashcards through the product API.
 * Deleting first keeps a re-run on an already-seeded tenant (CI seeds once) from
 * accumulating decks or cards, and stays inside the student's Base limits.
 */
async function resetDeck(page: Page): Promise<string> {
  const listResponse = await page.request.get(`${DECKS_URL}?limit=100`);
  expect(listResponse.ok(), `GET ${DECKS_URL} → ${listResponse.status()}`).toBe(true);
  const list = (await listResponse.json()) as ApiEnvelope<{ items: Deck[] }>;
  const existing = list.data.items.find((deck) => deck.name === DECK_NAME);
  if (existing) {
    const deleted = await page.request.delete(`${DECKS_URL}/${existing.id}`);
    expect(deleted.ok(), `DELETE ${DECKS_URL}/${existing.id} → ${deleted.status()}`).toBe(true);
  }

  const created = await page.request.post(DECKS_URL, {
    data: { name: DECK_NAME, visibility: 'personal' },
  });
  expect(created.status(), `POST ${DECKS_URL} (${DECK_NAME})`).toBe(201);
  const deck = ((await created.json()) as ApiEnvelope<Deck>).data;

  const cards = Array.from({ length: DECK_CARDS }, (_, index) => ({
    front: `${DECK_NAME} front ${index + 1}`,
    back: `${DECK_NAME} back ${index + 1}`,
  }));
  const bulk = await page.request.post(BULK_CREATE_URL, { data: { deckId: deck.id, cards } });
  expect(bulk.status(), `POST ${BULK_CREATE_URL} (${DECK_CARDS} cards)`).toBe(201);

  return deck.id;
}

test.describe(`${CASE} — no 5xx and no uncaught exceptions on a cross-role journey`, () => {
  test('public pages and the student panel load without console errors or 5xx', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    expect(tenant.org, `${CASE} tenant has an organization`).not.toBeNull();

    const monitor = new ConsoleNetworkMonitor(page);

    // A visitor: landing page, then the sign-in screen.
    await visitPublic(page, '/', 'h1');
    await visitPublic(page, '/login', 'input[name=email]');

    await loginAs(page, tenant, 'student');
    await expect(page).toHaveURL(/\/app$/);

    const deckId = await resetDeck(page);

    for (const path of STUDENT_PAGES) {
      await visit(page, path);
    }
    // Deck detail has a runtime id, so it is walked separately.
    await visit(page, `/app/flashcards/${deckId}`);
    await expect(page.getByRole('heading', { name: DECK_NAME, exact: true })).toBeVisible();

    // A client interaction: the user menu opens and closes cleanly.
    await visit(page, '/app');
    await exerciseUserMenu(page, tenant, 'student');

    expect(
      monitor.problems,
      `${CASE}: console/network problems during the student journey`,
    ).toEqual([]);
  });

  test('the educator panel loads without console errors or 5xx', async ({ page }) => {
    test.setTimeout(180_000);
    const tenant = loadTenant(CASE);

    const monitor = new ConsoleNetworkMonitor(page);
    await loginAs(page, tenant, 'teacher', { waitFor: /\/edu(\/|$)/ });
    await expect(page).toHaveURL(/\/edu$/);

    for (const path of TEACHER_PAGES) {
      await visit(page, path);
    }
    await visit(page, '/edu');
    await exerciseUserMenu(page, tenant, 'teacher');

    expect(
      monitor.problems,
      `${CASE}: console/network problems during the educator journey`,
    ).toEqual([]);
  });

  test('the manager panel loads without console errors or 5xx', async ({ page }) => {
    test.setTimeout(180_000);
    const tenant = loadTenant(CASE);

    const monitor = new ConsoleNetworkMonitor(page);
    await loginAs(page, tenant, 'manager', { waitFor: /\/manage(\/|$)/ });
    await expect(page).toHaveURL(/\/manage$/);

    for (const path of MANAGER_PAGES) {
      await visit(page, path);
    }
    await visit(page, '/manage');
    await exerciseUserMenu(page, tenant, 'manager');

    expect(
      monitor.problems,
      `${CASE}: console/network problems during the manager journey`,
    ).toEqual([]);
  });
});
