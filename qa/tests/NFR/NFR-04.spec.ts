import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * NFR-04 — mobile view (375 × 812).
 *
 * Case: on a phone-sized screen, walk the main screens of the three roles —
 * student (S1), teacher (T1) and manager (M1) — then open the hamburger sidebar
 * and the organization switcher. Expected:
 *
 * 1. the page never scrolls horizontally; a table scrolls inside its own
 *    container instead of widening the document;
 * 2. the rating buttons of a study session and the navigation buttons of a quiz
 *    are reachable with a thumb (inside the viewport, tall enough) and never
 *    overlap;
 * 3. dialogs fit the screen and can be closed.
 *
 * Tenant (deterministic, one run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts NFR-04 --fresh
 *
 * `qa/tests/profiles/NFR-04.json` declares the `content` profile — one
 * organization, its default group `G1`, and one account per account type. The
 * legacy S1/T1/M1 map to `users.student`, `users.teacher`, `users.manager`; every
 * id and credential is read through `loadTenant('NFR-04')`.
 *
 * The spec creates only its own content through the product API (a deck with
 * three cards for the study session, a two-question bank for the quiz), deleting
 * and recreating those rows so a re-run on the same tenant is deterministic. It
 * reads nothing global: no admin setting, feature flag, plan catalogue, platform
 * stat or singleton row.
 *
 * Device mode: the case's prerequisite is DevTools device mode at 375 × 812, so
 * the run emulates exactly that phone viewport on the runner's Chromium project:
 * 375 × 812, `isMobile`, touch and a 3× device pixel ratio. The product's layout
 * switches on the 375 px width (its `sm` breakpoints and the sidebar's `768 px`
 * `matchMedia`), never on the UA, so the emulation is spelled out instead of
 * borrowing a device descriptor: a descriptor carries its own browser engine, and
 * this runner ships Chromium only.
 */

const CASE = 'NFR-04';
const WIDTH = 375;
const HEIGHT = 812;

/** The rating buttons of a study session, in the order the product renders them. */
const RATING_SHORTCUTS = ['1', '2', '3', '4'];

const DECKS_URL = '/api/v1/flashcards/decks';
const BULK_CREATE_URL = '/api/v1/flashcards/batch/create';
const BANKS_URL = '/api/v1/questions/banks';
const QUESTIONS_URL = '/api/v1/questions';
const QUIZ_NEW_URL = '/api/v1/quiz/new';

const DECK_NAME = `${CASE} deck`;
const DECK_CARDS = 3;
const BANK_NAME = `${CASE} bank`;

/** Chrome that every signed-in role shows, so the page is really the dashboard. */
const NAV_TRIGGER = '[data-sidebar="trigger"]';

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error?: string;
}

interface Deck {
  id: string;
  name: string;
}

interface Bank {
  id: string;
  name: string;
}

interface QuizAttempt {
  id: string;
}

// The case's prerequisite is DevTools device mode at 375 × 812. Emulate it
// explicitly on the runner's single Chromium project — the same viewport, mobile
// layout viewport and touch the case asks for — instead of a device descriptor,
// which would carry its own browser engine. This runner ships Chromium only.
test.use({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});

function tenantOrThrow(): QaTenant {
  const tenant = loadTenant(CASE);
  if (!tenant.org || !tenant.users.student || !tenant.users.teacher || !tenant.users.manager) {
    throw new Error(
      `${CASE} fixture incomplete — seed it with: bun scripts/qa-tenant.ts ${CASE} --fresh`,
    );
  }
  return tenant;
}

async function getJson<T>(page: Page, url: string): Promise<T> {
  const res = await page.request.get(url);
  const body = (await res.json()) as ApiEnvelope<T>;
  expect(res.ok(), `GET ${url} → ${res.status()} ${JSON.stringify(body)}`).toBe(true);
  expect(body.success, `GET ${url} success`).toBe(true);
  return body.data;
}

async function postJson<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(url, { data });
  const body = (await res.json()) as ApiEnvelope<T>;
  expect(res.status(), `POST ${url} → ${res.status()} ${JSON.stringify(body)}`).toBe(201);
  expect(body.success, `POST ${url} success`).toBe(true);
  return body.data;
}

/**
 * The page itself never scrolls sideways. `scrollWidth` is the real test: a
 * container that is allowed to overflow inside itself still leaves the document
 * at the viewport width, while a table that widens the document pushes it up.
 */
async function expectNoPageHorizontalScroll(page: Page, screen: string): Promise<void> {
  const metrics = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  expect(metrics.innerWidth, `${screen}: mobile viewport width`).toBe(WIDTH);
  expect(metrics.documentScrollWidth, `${screen}: document scrollWidth`).toBeLessThanOrEqual(WIDTH);
  expect(metrics.bodyScrollWidth, `${screen}: body scrollWidth`).toBeLessThanOrEqual(WIDTH);

  // A horizontal wheel/scroll on the page must be a no-op.
  const scrolledX = await page.evaluate(() => {
    window.scrollTo(200, 0);
    return window.scrollX;
  });
  expect(scrolledX, `${screen}: page did not scroll horizontally`).toBe(0);
}

/** A control is fully on screen and tall enough to be tapped with a thumb. */
async function expectThumbTarget(locator: Locator, label: string, minHeight = 36): Promise<void> {
  const box = await locator.boundingBox();
  expect(box, `${label}: has a box`).not.toBeNull();
  expect(box!.x, `${label}: left edge inside the screen`).toBeGreaterThanOrEqual(0);
  expect(box!.y, `${label}: top edge inside the screen`).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, `${label}: right edge inside the screen`).toBeLessThanOrEqual(
    WIDTH + 0.5,
  );
  expect(box!.y + box!.height, `${label}: bottom edge inside the screen`).toBeLessThanOrEqual(
    HEIGHT + 0.5,
  );
  // The product's action buttons are at least 36 px tall; thumb-reachable means
  // at least that. Compact icon-sized controls can opt into a smaller floor.
  expect(box!.height, `${label}: touch height`).toBeGreaterThanOrEqual(minHeight);
}

/** No two controls occupy the same pixels (the case's „nie nachodzą na siebie”). */
async function expectNoOverlap(locators: { name: string; box: Box }[]): Promise<void> {
  for (let i = 0; i < locators.length; i++) {
    for (let j = i + 1; j < locators.length; j++) {
      const a = locators[i]!;
      const b = locators[j]!;
      const separated =
        a.box.x + a.box.width <= b.box.x + 0.5 ||
        b.box.x + b.box.width <= a.box.x + 0.5 ||
        a.box.y + a.box.height <= b.box.y + 0.5 ||
        b.box.y + b.box.height <= a.box.y + 0.5;
      expect(separated, `„${a.name}” does not overlap „${b.name}”`).toBe(true);
    }
  }
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  expect(box, 'control has a box').not.toBeNull();
  return box!;
}

/**
 * A table must be wider than its container (that is why the case mentions it)
 * and scroll inside that container; the container itself stays inside the
 * viewport and the page stays at 375 px.
 */
async function expectTableScrollsInsideItsContainer(
  container: Locator,
  label: string,
): Promise<void> {
  await expect(container, `${label}: table container`).toHaveCount(1);
  const info = await container.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      overflowX: getComputedStyle(element).overflowX,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      left: rect.left,
      right: rect.right,
    };
  });
  expect(info.overflowX, `${label}: container scrolls horizontally`).toBe('auto');
  expect(info.left, `${label}: container left edge`).toBeGreaterThanOrEqual(0);
  expect(info.right, `${label}: container right edge`).toBeLessThanOrEqual(WIDTH + 0.5);
  expect(info.scrollWidth, `${label}: table is wider than its container`).toBeGreaterThan(
    info.clientWidth,
  );

  const scrolled = await container.evaluate((element) => {
    element.scrollLeft = 80;
    return element.scrollLeft;
  });
  expect(scrolled, `${label}: container can be scrolled sideways`).toBeGreaterThan(0);
}

/** Recreate the case's deck with a deterministic name through the product API. */
async function resetDeck(page: Page): Promise<Deck> {
  const list = await getJson<{ items: Deck[] }>(page, `${DECKS_URL}?limit=100`);
  for (const deck of list.items.filter((item) => item.name === DECK_NAME)) {
    const deleted = await page.request.delete(`${DECKS_URL}/${deck.id}`);
    expect(deleted.ok(), `DELETE ${DECKS_URL}/${deck.id} → ${deleted.status()}`).toBe(true);
  }

  const deck = await postJson<Deck>(page, DECKS_URL, {
    name: DECK_NAME,
    visibility: 'personal',
  });
  const cards = Array.from({ length: DECK_CARDS }, (_, index) => ({
    front: `${CASE} front ${index + 1}`,
    back: `${CASE} back ${index + 1}`,
  }));
  await postJson(page, BULK_CREATE_URL, { deckId: deck.id, cards });
  return deck;
}

/**
 * Recreate the case's two multiple-choice questions in a personal bank. A
 * student's `question.read` scope is `own`, so the quiz generator only sees the
 * questions this spec creates as that student.
 */
async function resetQuestionBank(page: Page): Promise<void> {
  const list = await getJson<{ items: Bank[] }>(page, `${BANKS_URL}?limit=100`);
  for (const bank of list.items.filter((item) => item.name === BANK_NAME)) {
    const deleted = await page.request.delete(`${BANKS_URL}/${bank.id}`);
    expect(deleted.ok(), `DELETE ${BANKS_URL}/${bank.id} → ${deleted.status()}`).toBe(true);
  }

  const bank = await postJson<Bank>(page, BANKS_URL, { name: BANK_NAME, visibility: 'personal' });
  for (const index of [1, 2]) {
    await postJson(page, QUESTIONS_URL, {
      bankId: bank.id,
      type: 'mcq',
      content: `${CASE} question ${index}`,
      answers: [
        { content: `${CASE} answer ${index}a`, isCorrect: true, orderIndex: 0 },
        { content: `${CASE} answer ${index}b`, isCorrect: false, orderIndex: 1 },
      ],
    });
  }
}

/** Start a practice quiz from the two questions and open its taking screen. */
async function openQuizSession(page: Page): Promise<void> {
  await resetQuestionBank(page);
  const attempt = await postJson<QuizAttempt>(page, QUIZ_NEW_URL, {
    questionTypes: ['mcq'],
    questionCount: 2,
  });
  await page.goto(`/app/study/session/quiz/${attempt.id}`);
  await expect(page).toHaveURL(new RegExp(`/app/study/session/quiz/${attempt.id}$`));
  await expect(page.getByText(/Pytanie 1 z 2/)).toBeVisible();
}

test.describe('NFR-04 — mobile view 375 × 812', () => {
  test.setTimeout(90_000);

  test('the student dashboard, deck list and quiz page do not scroll horizontally', async ({
    page,
  }) => {
    const tenant = tenantOrThrow();
    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app/ });
    await resetDeck(page);

    for (const screen of ['/app', '/app/flashcards', '/app/study/quiz']) {
      await page.goto(screen);
      expect(page.url(), `${screen}: stayed on the screen`).toMatch(
        new RegExp(`${screen.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
      );
      await expect(page.locator(NAV_TRIGGER)).toBeVisible();
      await expectNoPageHorizontalScroll(page, screen);
    }

    // The deck list really rendered the case's deck inside the mobile column.
    await page.goto('/app/flashcards');
    await expect(
      page.getByRole('heading', { name: DECK_NAME }).filter({ visible: true }),
    ).toHaveCount(1);
    await expectNoPageHorizontalScroll(page, '/app/flashcards (with a deck)');
  });

  test('study-session and quiz controls stay on screen, clear of each other', async ({ page }) => {
    const tenant = tenantOrThrow();
    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app/ });
    const deck = await resetDeck(page);

    // Step 1 — a study session over the case's deck. „Wkuwaj” is the session
    // view that always has the deck's cards, so the assertion does not depend on
    // SM-2 due dates that an earlier run may already have moved.
    await page.goto(`/app/study/session/cram?deckId=${deck.id}`);
    await expect(page).toHaveURL(/\/app\/study\/session\/cram\?/);
    await expectNoPageHorizontalScroll(page, 'study session');

    const ratings = RATING_SHORTCUTS.map((key) =>
      page.locator(`button[aria-keyshortcuts="${key}"]`),
    );
    const ratingBoxes: { name: string; box: Box }[] = [];
    for (const [index, rating] of ratings.entries()) {
      await expect(rating).toBeVisible();
      const name = (await rating.innerText()).replace(/\s+/g, ' ').trim();
      await expectThumbTarget(rating, `study rating „${name}” (${index + 1}/4)`);
      ratingBoxes.push({ name, box: await boxOf(rating) });
    }
    await expectNoOverlap(ratingBoxes);
    await expectThumbTarget(
      page.getByRole('button', { name: 'Zakończ sesję', exact: true }),
      'study session „Zakończ sesję”',
      32,
    );

    // Step 1 — a quiz with two questions: „Poprzednie” and „Następne” share one
    // row on a phone and must not collide.
    await openQuizSession(page);
    await expectNoPageHorizontalScroll(page, 'quiz session');

    const previous = page.getByRole('button', { name: 'Poprzednie', exact: true });
    const next = page.getByRole('button', { name: 'Następne', exact: true });
    await expect(previous).toBeVisible();
    await expect(next).toBeVisible();
    await expectThumbTarget(previous, 'quiz „Poprzednie”');
    await expectThumbTarget(next, 'quiz „Następne”');
    await expectNoOverlap([
      { name: 'Poprzednie', box: await boxOf(previous) },
      { name: 'Następne', box: await boxOf(next) },
    ]);

    // Every answer row is inside the viewport too, so the quiz is usable without
    // horizontal panning.
    const answerRows = page.getByRole('radio').locator('xpath=..');
    await expect(answerRows).toHaveCount(2);
    for (const [index, row] of (await answerRows.all()).entries()) {
      await expectThumbTarget(row, `quiz answer row ${index + 1}`);
    }
  });

  test('teacher and manager screens fit; member tables scroll inside themselves', async ({
    page,
  }) => {
    const tenant = tenantOrThrow();

    await loginAs(page, tenant, 'teacher', { locale: 'pl', waitFor: /\/edu/ });
    for (const screen of ['/edu', '/edu/flashcards', '/edu/quizzes/new', '/edu/assignments/new']) {
      await page.goto(screen);
      await expect(page.locator(NAV_TRIGGER)).toBeVisible();
      await expectNoPageHorizontalScroll(page, screen);
    }
    await expect(page.getByRole('button', { name: 'Utwórz kartkówkę', exact: true })).toBeVisible();

    // „Lista członków” for the teacher: a wide table inside its own scroll box.
    await page.goto('/edu/classroom/members');
    await expectNoPageHorizontalScroll(page, '/edu/classroom/members');
    await expectTableScrollsInsideItsContainer(
      page.locator('[data-slot="table-container"]'),
      '/edu/classroom/members',
    );

    await loginAs(page, tenant, 'manager', { locale: 'pl', waitFor: /\/manage/ });
    for (const screen of ['/manage', '/manage/members']) {
      await page.goto(screen);
      await expect(page.locator(NAV_TRIGGER)).toBeVisible();
      await expectNoPageHorizontalScroll(page, screen);
    }
    await expectTableScrollsInsideItsContainer(
      page.locator('[data-slot="table-container"]'),
      '/manage/members',
    );
    // The table has the tenant's real rows: the seeded student and its group.
    const memberTable = page.locator('[data-slot="table"]');
    await expect(memberTable.getByText(tenant.users.student!.email, { exact: true })).toBeVisible();
    await expect(memberTable.getByText(tenant.group!.name, { exact: true }).first()).toBeVisible();
  });

  test('the hamburger sidebar and the organization switcher open inside the screen', async ({
    page,
  }) => {
    const tenant = tenantOrThrow();
    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app/ });
    await expectNoPageHorizontalScroll(page, '/app before the sidebar');

    const trigger = page.locator(NAV_TRIGGER);
    await expect(trigger).toBeVisible();
    const triggerBox = await boxOf(trigger);
    expect(triggerBox.x, 'hamburger is on screen').toBeGreaterThanOrEqual(0);
    expect(triggerBox.x + triggerBox.width).toBeLessThanOrEqual(WIDTH + 0.5);

    await trigger.click();
    const sheet = page.locator('[data-mobile="true"]');
    await expect(sheet).toBeVisible();
    // The sheet slides in from the left; wait until it has settled at x = 0
    // before measuring, so the check is about the final layout, not the tween.
    await expect
      .poll(async () => (await sheet.boundingBox())?.x ?? -1, {
        message: 'mobile sidebar settled at the left edge',
      })
      .toBeGreaterThanOrEqual(0);
    const sheetBox = await sheet.boundingBox();
    expect(sheetBox, 'mobile sidebar has a box').not.toBeNull();
    expect(sheetBox!.x, 'sidebar left edge').toBeGreaterThanOrEqual(0);
    expect(sheetBox!.y, 'sidebar top edge').toBeGreaterThanOrEqual(0);
    expect(sheetBox!.x + sheetBox!.width, 'sidebar right edge').toBeLessThanOrEqual(WIDTH + 0.5);
    expect(sheetBox!.y + sheetBox!.height, 'sidebar bottom edge').toBeLessThanOrEqual(HEIGHT + 0.5);
    await expectNoPageHorizontalScroll(page, '/app with the sidebar open');

    // Step 2 — the organization switcher inside the sidebar.
    const orgButton = sheet.locator('button').filter({ hasText: tenant.org!.name }).first();
    await expect(orgButton).toBeVisible();
    await orgButton.click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu).toContainText(tenant.org!.name);
    const menuBox = await menu.boundingBox();
    expect(menuBox, 'org menu has a box').not.toBeNull();
    expect(menuBox!.x, 'org menu left edge').toBeGreaterThanOrEqual(0);
    expect(menuBox!.x + menuBox!.width, 'org menu right edge').toBeLessThanOrEqual(WIDTH + 0.5);
    expect(menuBox!.y + menuBox!.height, 'org menu bottom edge').toBeLessThanOrEqual(HEIGHT + 0.5);

    // The menu closes, and so does the sidebar behind it.
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(sheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
  });

  test('dialogs fit the screen and can be closed', async ({ page }) => {
    const tenant = tenantOrThrow();

    /** Both dialog checks share the same geometry contract. */
    async function expectDialogFits(label: string): Promise<void> {
      const dialog = page.getByRole('dialog').filter({ has: page.locator('button') });
      await expect(dialog).toBeVisible();
      const box = await dialog.boundingBox();
      expect(box, `${label}: dialog has a box`).not.toBeNull();
      expect(box!.x, `${label}: left edge`).toBeGreaterThanOrEqual(0);
      expect(box!.y, `${label}: top edge`).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, `${label}: right edge`).toBeLessThanOrEqual(WIDTH + 0.5);
      expect(box!.y + box!.height, `${label}: bottom edge`).toBeLessThanOrEqual(HEIGHT + 0.5);
      await expectNoPageHorizontalScroll(page, `${label} (open)`);
    }

    // Student: the „Nowa talia” form, opened from the mobile speed dial.
    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app/ });
    await page.goto('/app/flashcards');
    await page.locator('[data-speed-dial] > button').last().click();
    const newDeck = page.locator('[data-speed-dial] button').first();
    await newDeck.hover();
    await expect(page.getByRole('tooltip')).toHaveText('Nowa talia');
    await newDeck.click();
    await expectDialogFits('Nowa talia');
    await expect(page.getByRole('heading', { name: 'Utwórz talię', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Manager: the „Nowa grupa” form, closed with its own close button.
    await loginAs(page, tenant, 'manager', { locale: 'pl', waitFor: /\/manage/ });
    await page.goto('/manage/groups');
    await page.getByRole('button', { name: 'Nowa grupa', exact: true }).click();
    await expectDialogFits('Nowa grupa');
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
