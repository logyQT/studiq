import { expect, test, type Locator, type Page } from '@playwright/test';
import { json } from '#test/helpers/json';
import { loadTenant, loginAs } from '#test/qa/fixtures/tenant';

/**
 * NFR-04 — the mobile view (375 × 812).
 *
 * Case: in DevTools device mode, walk the main screens of S1, T1 and M1 — the
 * dashboard, the deck list, the study session, the quiz, the quiz editor, the
 * member list and the test form — then open the sidebar hamburger and the
 * organization switcher. Expected: no horizontal page scroll, tables scroll
 * inside their own container, the study and quiz buttons are thumb-sized and do
 * not overlap each other, and dialogs fit the screen and can be closed.
 *
 * Tenant: `content` (no profile file), one run suffix per independent run:
 *
 *   bun run env:run -- bun scripts/qa-tenant.ts NFR-04 --fresh
 *
 * It carries the manager, the educator and the `student` this case signs in as,
 * plus the default group `G1`. Every name this spec types carries the run
 * suffix (`tenant.runSuffix`), so two seeded tenants never collide. The deck,
 * the question bank and the quiz attempt are created by the student through the
 * product API inside that tenant; nothing global (plan, feature flag, admin
 * setting, singleton) is read or written.
 *
 * Walk (2026-11-28, test/qa-NFR-04 @ 896687d68), served production build at a
 * 375 × 812 viewport with touch enabled:
 * - `/app`, `/app/flashcards`, `/app/study/learn`, `/app/study/session/new`,
 *   `/app/study/session/quiz/<attempt>`, `/edu`, `/edu/quizzes/new`,
 *   `/edu/assignments/new`, `/manage`, `/manage/members`: the document's
 *   `scrollWidth` equals the viewport (375) on every one.
 * - The member table is 867 px wide inside a 326 px `overflow-x-auto`
 *   `[data-slot="table-container"]`; the page itself does not grow.
 * - The four study ratings render as a 2 × 2 grid, 160 × 36 each, at y 638–718
 *   (812 px tall screen, no scrolling needed). The quiz footer puts
 *   „Poprzednie” (130 × 36) and „Zakończ test” (138 × 36) on one row at y 441.
 * - The sidebar trigger opens a 288 × 812 mobile sheet that carries the org
 *   switcher; its menu is 271 px wide starting at x 8. The member dialog
 *   („Zarządzaj grupami”) is 375 × 232 and closes with „Anuluj”.
 *
 * Mutation (proves this spec can fail): remove `overflow-x-auto` from the
 * shared table container (`packages/ui/src/components/ui/table.tsx`), so the
 * 867 px member table has no scrollport of its own. Rebuilt, the spec went red
 * on the containment assertion:
 *
 *   Error: the table scrolls inside its own container, not the page
 *   Expected pattern: /^(auto|scroll)$/
 *   Received string:  "visible"
 *
 * Restored, rebuilt, green again.
 */

const CASE = 'NFR-04';
/** DevTools device-mode size from the case, as a phone in portrait. */
const VIEWPORT = { width: 375, height: 812 };

test.use({ viewport: VIEWPORT, hasTouch: true });

const DECKS_URL = '/api/v1/flashcards/decks';
const CARDS_URL = '/api/v1/flashcards';
const BANKS_URL = '/api/v1/questions/banks';
const QUESTIONS_URL = '/api/v1/questions';
const QUIZ_URL = '/api/v1/quiz/new';

const CARD_COUNT = 3;

const UI = {
  startLearning: 'Rozpocznij naukę',
  quizEditorTitle: 'Nowy quiz',
  assignmentTitle: 'Nowa kartkówka',
  membersTitle: 'Członkowie',
  manageGroups: 'Zarządzaj grupami',
  cancel: 'Anuluj',
  ratings: ['Nie pamiętam (reset)', 'Trudne (zostań)', 'Dobrze (dalej)', 'Łatwe (zakończ)'],
  sidebarTrigger: 'Przełącz pasek boczny',
} as const;

interface Envelope<T> {
  success: boolean;
  data: T;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Create a row through the product API and fail with the server's answer if it does not. */
async function postData<T>(page: Page, url: string, data: unknown): Promise<T> {
  const response = await page.request.post(url, { data });
  const body = await json<Envelope<T>>(response);
  expect(response.status(), `POST ${url} → ${response.status()} ${JSON.stringify(body)}`).toBe(201);
  return body.data;
}

/**
 * The screen's own scroll: what a phone actually cannot do horizontally. The
 * document is the scrollport here (each area is a full-height layout), so a
 * `scrollWidth` above the viewport means the page pans sideways.
 */
async function expectNoHorizontalPageScroll(page: Page, screen: string): Promise<void> {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    viewport: window.innerWidth,
  }));
  expect(
    metrics.scrollWidth,
    `${screen}: no horizontal page scroll at ${metrics.viewport}px (document scrollWidth ${metrics.scrollWidth}, clientWidth ${metrics.clientWidth})`,
  ).toBeLessThanOrEqual(metrics.clientWidth);
}

/** A visible control's box, with the layout assertion's own message when it has none. */
async function boxOf(locator: Locator, label: string): Promise<Box> {
  await expect(locator, `${label} is rendered`).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} has a layout box`).not.toBeNull();
  if (!box) throw new Error(`${label} has no layout box`);
  return box;
}

/**
 * Radix overlays animate in — the mobile sheet slides from the edge and the
 * menu/dialog zoom — so a box read mid-transition is scaled or off-canvas.
 * Await the element's own animations before measuring the settled overlay.
 */
async function settled(locator: Locator): Promise<void> {
  await locator.evaluate((element) =>
    Promise.all(
      element.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}

/**
 * A control a thumb can hit without hunting: on screen without panning, large
 * enough for a finger, and clear of every other control the screen puts beside
 * it. The measured product renders the study / quiz actions at 36 px tall and
 * 130–160 px wide; the floor here is a deliberate margin below that.
 */
function expectThumbTarget(box: Box, label: string, screen: string): void {
  expect(box.x, `${screen}: ${label} starts on screen`).toBeGreaterThanOrEqual(0);
  expect(box.y, `${screen}: ${label} starts on screen`).toBeGreaterThanOrEqual(0);
  expect(
    box.x + box.width,
    `${screen}: ${label} ends on screen (right edge ${box.x + box.width} > ${VIEWPORT.width})`,
  ).toBeLessThanOrEqual(VIEWPORT.width);
  expect(
    box.y + box.height,
    `${screen}: ${label} ends on screen (bottom edge ${box.y + box.height} > ${VIEWPORT.height})`,
  ).toBeLessThanOrEqual(VIEWPORT.height);
  expect(box.width, `${screen}: ${label} is a wide tap target`).toBeGreaterThanOrEqual(100);
  expect(box.height, `${screen}: ${label} is a tall tap target`).toBeGreaterThanOrEqual(32);
}

function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Every control is inside the screen and no two of them cover each other. */
async function expectSeparateThumbTargets(screen: string, locators: Locator[]): Promise<void> {
  expect(locators.length, `${screen}: the controls are named`).toBeGreaterThan(1);
  const boxes: Box[] = [];
  for (const [index, target] of locators.entries()) {
    const label = (await target.textContent())?.trim() || `control ${index + 1}`;
    const box = await boxOf(target, `${screen}: ${label}`);
    expectThumbTarget(box, label, screen);
    boxes.push(box);
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      expect(
        intersects(boxes[i]!, boxes[j]!),
        `${screen}: “${(await locators[i]!.textContent())?.trim()}” and “${(await locators[j]!.textContent())?.trim()}” do not overlap`,
      ).toBe(false);
    }
  }
}

test.describe('@case:NFR-04 @area:NFR @prio:P1 mobile layout at 375x812', () => {
  test('no page pans, the table scrolls in place, and the mobile chrome fits', async ({ page }) => {
    test.setTimeout(150_000);
    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} runs on the content profile`).toBe('content');
    expect(
      tenant.runSuffix,
      'seed with --fresh: every independent run owns a new tenant',
    ).toBeTruthy();
    const run = tenant.runSuffix ?? tenant.key.slice(-6);
    const deckName = `${CASE} deck ${run}`;

    // ── S1: dashboard, deck list, study session ─────────────────────────────
    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });
    await expectNoHorizontalPageScroll(page, 'student dashboard (/app)');
    await expect(
      page.getByRole('button', { name: UI.sidebarTrigger }),
      'the mobile chrome has its sidebar trigger',
    ).toBeVisible();

    const deck = await postData<{ id: string }>(page, DECKS_URL, { name: deckName });
    for (let index = 1; index <= CARD_COUNT; index++) {
      await postData(page, CARDS_URL, {
        deckId: deck.id,
        front: `Pytanie ${index} ${run}`,
        back: `Odpowiedź ${index} ${run}`,
      });
    }
    await page.goto('/app/flashcards');
    await expect(page.getByText(deckName, { exact: true }).first()).toBeVisible();
    await expectNoHorizontalPageScroll(page, 'deck list (/app/flashcards)');

    await page.goto('/app/study/learn');
    const startLearning = page.getByRole('button', { name: UI.startLearning, exact: true });
    await expect(startLearning.first()).toBeVisible();
    await expectNoHorizontalPageScroll(page, 'study start (/app/study/learn)');
    await startLearning.first().click();
    await expect(page).toHaveURL(/\/app\/study\/session\/new\?studyMode=endless$/);
    await expectNoHorizontalPageScroll(page, 'study session (/app/study/session/new)');

    const ratings = UI.ratings.map((name) => page.getByRole('button', { name, exact: true }));
    for (const rating of ratings) {
      await expect(rating, 'the four learning ratings are the study controls').toHaveCount(1);
    }
    await expectSeparateThumbTargets('study session', ratings);

    // ── S1: quiz ────────────────────────────────────────────────────────────
    const questionBank = await postData<{ id: string }>(page, BANKS_URL, {
      name: `${CASE} bank ${run}`,
    });
    await postData(page, QUESTIONS_URL, {
      bankId: questionBank.id,
      type: 'mcq',
      content: 'Kiedy przyjęto chrzest Polski?',
      explanation:
        'Chrzest Polski przyjmuje się na rok 966, gdy Mieszko I przyjął chrzest w obrządku łacińskim.',
      answers: [
        { content: '966', isCorrect: true, orderIndex: 0 },
        { content: '1000', isCorrect: false, orderIndex: 1 },
        { content: '1310', isCorrect: false, orderIndex: 2 },
      ],
    });
    await postData(page, QUESTIONS_URL, {
      bankId: questionBank.id,
      type: 'true_false',
      content: 'Bitwa pod Grunwaldem odbyła się w 1410 roku.',
      explanation:
        'Bitwa pod Grunwaldem rozegrała się 15 lipca 1410 roku i zakończyła zwycięstwem wojsk polsko-litewskich.',
      answers: [
        { content: 'Prawda', isCorrect: true, orderIndex: 0 },
        { content: 'Fałsz', isCorrect: false, orderIndex: 1 },
      ],
    });
    const attempt = await postData<{ id: string; questions: unknown[] }>(page, QUIZ_URL, {
      bankId: questionBank.id,
      questionTypes: ['mcq', 'true_false'],
      questionCount: 2,
    });
    expect(attempt.questions, 'the attempt has both questions').toHaveLength(2);

    await page.goto(`/app/study/session/quiz/${attempt.id}`);
    const quizFooter = page.locator('[data-slot="card-footer"]').locator('button');
    await expect(quizFooter, 'the quiz footer has its two actions').toHaveCount(2);
    await expectNoHorizontalPageScroll(page, 'quiz (/app/study/session/quiz)');
    await expectSeparateThumbTargets('quiz', [quizFooter.nth(0), quizFooter.nth(1)]);

    // ── T1: dashboard, quiz editor, test form ───────────────────────────────
    await loginAs(page, tenant, 'teacher', { locale: 'pl', waitFor: /\/edu$/ });
    await expectNoHorizontalPageScroll(page, 'educator dashboard (/edu)');

    await page.goto('/edu/quizzes/new');
    await expect(page.getByRole('heading', { name: UI.quizEditorTitle })).toBeVisible();
    await expectNoHorizontalPageScroll(page, 'quiz editor (/edu/quizzes/new)');

    await page.goto('/edu/assignments/new');
    await expect(page.getByRole('heading', { name: UI.assignmentTitle })).toBeVisible();
    await expectNoHorizontalPageScroll(page, 'test form (/edu/assignments/new)');

    // ── M1: dashboard, member list, table containment, dialog ───────────────
    await loginAs(page, tenant, 'manager', { locale: 'pl', waitFor: /\/manage$/ });
    await expectNoHorizontalPageScroll(page, 'manager dashboard (/manage)');

    await page.goto('/manage/members');
    await expect(page.getByRole('heading', { name: UI.membersTitle, exact: true })).toBeVisible();
    await expectNoHorizontalPageScroll(page, 'member list (/manage/members)');

    const tableContainer = page.locator('[data-slot="table-container"]').first();
    await expect(tableContainer, 'the member list renders its table').toBeVisible();
    const table = await tableContainer.evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      overflowX: getComputedStyle(element).overflowX,
    }));
    expect(
      table.scrollWidth,
      `the member table is wider than the phone, so its container is what pans (table ${table.scrollWidth}px, container ${table.clientWidth}px)`,
    ).toBeGreaterThan(table.clientWidth);
    expect(table.overflowX, 'the table scrolls inside its own container, not the page').toMatch(
      /^(auto|scroll)$/,
    );

    const manageGroups = page.getByRole('button', { name: UI.manageGroups, exact: true });
    await expect(manageGroups, 'a member row offers the groups dialog').toHaveCount(2);
    await manageGroups.first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await settled(dialog);
    const dialogBox = await boxOf(dialog, 'groups dialog');
    expect(dialogBox.x, 'the dialog starts on screen').toBeGreaterThanOrEqual(0);
    expect(dialogBox.y, 'the dialog starts on screen').toBeGreaterThanOrEqual(0);
    expect(
      dialogBox.x + dialogBox.width,
      `the dialog fits the screen width (${dialogBox.x + dialogBox.width} > ${VIEWPORT.width})`,
    ).toBeLessThanOrEqual(VIEWPORT.width);
    expect(
      dialogBox.y + dialogBox.height,
      `the dialog fits the screen height (${dialogBox.y + dialogBox.height} > ${VIEWPORT.height})`,
    ).toBeLessThanOrEqual(VIEWPORT.height);
    await expectNoHorizontalPageScroll(page, 'member list with the groups dialog open');
    await dialog.getByRole('button', { name: UI.cancel, exact: true }).click();
    await expect(dialog, 'the groups dialog closes').toHaveCount(0);

    // ── M1: sidebar hamburger and organization switcher ─────────────────────
    await page.getByRole('button', { name: UI.sidebarTrigger }).click();
    const sheet = page.locator('[data-slot="sidebar"][data-mobile="true"]');
    await expect(sheet, 'the hamburger opens the mobile sidebar').toBeVisible();
    await settled(sheet);
    const sheetBox = await boxOf(sheet, 'mobile sidebar');
    expect(sheetBox.x, 'the sidebar starts on screen').toBeGreaterThanOrEqual(0);
    expect(
      sheetBox.x + sheetBox.width,
      `the sidebar fits the screen width (${sheetBox.x + sheetBox.width} > ${VIEWPORT.width})`,
    ).toBeLessThanOrEqual(VIEWPORT.width);
    expect(
      sheetBox.y + sheetBox.height,
      `the sidebar fits the screen height (${sheetBox.y + sheetBox.height} > ${VIEWPORT.height})`,
    ).toBeLessThanOrEqual(VIEWPORT.height);
    await expectNoHorizontalPageScroll(page, 'mobile sidebar open');

    const orgName = tenant.org?.name;
    expect(orgName, 'the tenant has its organization').toBeTruthy();
    const orgTrigger = sheet.getByRole('button').filter({ hasText: orgName! });
    await expect(orgTrigger, 'the sidebar carries the organization switcher').toHaveCount(1);
    await orgTrigger.click();
    const orgMenu = page.getByRole('menu');
    await expect(orgMenu, 'the organization switcher opens').toBeVisible();
    await settled(orgMenu);
    const menuBox = await boxOf(orgMenu, 'organization menu');
    expect(menuBox.x, 'the organization menu starts on screen').toBeGreaterThanOrEqual(0);
    expect(
      menuBox.x + menuBox.width,
      `the organization menu fits the screen width (${menuBox.x + menuBox.width} > ${VIEWPORT.width})`,
    ).toBeLessThanOrEqual(VIEWPORT.width);
    await expect(
      orgMenu.getByRole('menuitem').filter({ hasText: orgName! }),
      'the menu lists the tenant organization',
    ).toHaveCount(1);
    await expectNoHorizontalPageScroll(page, 'organization switcher open');

    await page.keyboard.press('Escape');
    await expect(orgMenu, 'the organization switcher closes').toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(sheet, 'the mobile sidebar closes').toHaveCount(0);
  });
});
