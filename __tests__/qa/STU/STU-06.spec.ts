import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * STU-06 — Nauka fiszek: skróty klawiaturowe (`/app/study/session/[type]`).
 *
 * Case steps: start a study session, press Space, then 1–4 on consecutive cards,
 * and check the shortcuts toast/panel.
 *
 * Tenant (deterministic, `content` profile, fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts STU-06 --fresh
 *
 * gives the org `qa-stu-06-<suffix>` with a manager, an educator and a student,
 * where every id derives from
 * `tenantKey('qa/cases/STU-06.md', 'STU-06#<suffix>', 'qa-shared')` + `tenantId`.
 * Nothing global is read or written: no admin setting, feature flag, plan,
 * platform stat or singleton row. The spec builds its own deck and cards through
 * the product API as that student, so the new-card queue is exactly this deck.
 *
 * The case was written against the legacy seed (`student1@dev.local`, password
 * `pass`); the suite version uses the tenant student and its default password.
 *
 * Acceptance points (confirmed on the shared app during the walk):
 * 1. Space flips the card front ⇄ back and flips back again (the session rotates
 *    the card to `rotateY(180deg)` and the „Kliknij, aby odkryć odpowiedź” hint is
 *    rendered only while the question side is up).
 * 2. The four rating keys stay inert while the question side is up — no rating is
 *    recorded and the card does not advance.
 * 3. After the reveal, 1–4 rate the card and advance to the next one, with the
 *    case's mapping: 1 „Nie pamiętam”, 2 „Trudne”, 3 „Dobrze”, 4 „Łatwe” (1/2 are
 *    incorrect, 3/4 correct — the practice badge and the batch payload agree).
 * 4. The session exposes a shortcuts panel (the keyboard icon, also Alt+K) that
 *    lists Space + 1–4 with their actions. The legacy toast (`shortcut_toast`) is
 *    not rendered; the case allows either ("toast … lub panel skrótów").
 */

const CASE = 'STU-06';

/** How many cards the case needs: four ratings on four consecutive cards + one spare. */
const CARD_COUNT = 5;

const CARD_FRONTS = Array.from({ length: CARD_COUNT }, (_, index) => `STU-06 karta ${index + 1}`);

/** Polish copy from `AppFlashcardStudyPage` / `AppFlashcardSessionPage` (pl.json). */
const COPY = {
  newCardsTitle: 'Nowe karty',
  newCardsAvailable: 'nowych kart dostępnych do nauki',
  startLearning: 'Rozpocznij naukę',
  flipHint: 'Kliknij, aby odkryć odpowiedź',
  exitSession: 'Zakończ sesję',
  shortcutsTrigger: 'Keyboard shortcuts',
  flipAction: 'Odwróć fiszkę',
} as const;

/** `correct_badge` — the case's 1–4 mapping is visible through it. */
function correctBadge(correct: number, total: number): string {
  return `${correct}/${total} poprawnych`;
}

/**
 * The case's key → rating mapping. The labels are the base ones; a card whose
 * review state is „learning” renders the longer variants (`Nie pamiętam (reset)`,
 * `Dobrze (dalej)`, …), so the assertions match on the label prefix.
 */
const RATINGS = [
  { key: '1', label: 'Nie pamiętam', confidenceLevel: 1, wasCorrect: false },
  { key: '2', label: 'Trudne', confidenceLevel: 2, wasCorrect: false },
  { key: '3', label: 'Dobrze', confidenceLevel: 3, wasCorrect: true },
  { key: '4', label: 'Łatwe', confidenceLevel: 4, wasCorrect: true },
] as const;

/**
 * `rotateY(180deg)` on the flip container, as Chromium serialises it. The panel
 * config runs Chromium only, and the spring animation settles on this exact value.
 */
const FLIPPED_TRANSFORM = 'matrix3d(-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1)';

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface DeckItem {
  id: string;
  name: string;
}

interface FlashcardItem {
  id: string;
  front: string;
  back: string;
  deck_id: string;
}

interface PracticeBatch {
  mode: string;
  items: {
    flashcardId: string;
    wasCorrect: boolean;
    confidenceLevel: number;
    sessionId: string;
  }[];
}

/** `GET` an endpoint as the signed-in student and unwrap the response envelope. */
async function getData<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  expect(response.ok(), `GET ${url} → ${response.status()} ${await response.text()}`).toBe(true);
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(body.success, `GET ${url} success flag`).toBe(true);
  return body.data;
}

/**
 * The case's deck, created by the student through the product API. The name is
 * derived from the tenant's run suffix, so two independent runs never share a
 * deck (and therefore never share already-studied cards).
 */
function deckName(tenant: QaTenant): string {
  return `STU-06 karty ${tenant.runSuffix ?? 'stable'}`;
}

async function ensureDeck(page: Page, name: string): Promise<string> {
  const decks = await getData<{ items: DeckItem[] }>(page, '/api/v1/flashcards/decks?limit=200');
  const existing = decks.items.find((deck) => deck.name === name);
  if (existing) return existing.id;

  const response = await page.request.post('/api/v1/flashcards/decks', {
    data: { name, visibility: 'personal' },
  });
  expect(
    response.status(),
    `POST /api/v1/flashcards/decks (${name}) → ${response.status()} ${await response.text()}`,
  ).toBe(201);
  const body = (await response.json()) as ApiEnvelope<DeckItem>;
  expect(body.success, 'deck create success flag').toBe(true);
  return body.data.id;
}

/** The deck's five cards, keyed by front; created only when missing (idempotent). */
async function ensureCards(page: Page, deckId: string): Promise<Map<string, string>> {
  const cards = await getData<{ items: FlashcardItem[] }>(
    page,
    `/api/v1/flashcards?deckIds=${deckId}&limit=100`,
  );
  const byFront = new Map(cards.items.map((card) => [card.front, card.id]));

  for (const front of CARD_FRONTS) {
    if (byFront.has(front)) continue;
    const response = await page.request.post('/api/v1/flashcards', {
      data: { deckId, front, back: front.replace('karta', 'odpowiedź') },
    });
    expect(
      response.status(),
      `POST /api/v1/flashcards (${front}) → ${response.status()} ${await response.text()}`,
    ).toBe(201);
    const body = (await response.json()) as ApiEnvelope<FlashcardItem>;
    expect(body.success, `flashcard ${front} create success flag`).toBe(true);
    byFront.set(front, body.data.id);
  }

  expect([...byFront.keys()].sort(), 'the deck holds the case’s five cards').toEqual(
    [...CARD_FRONTS].sort(),
  );
  return byFront;
}

/** Prepare the tenant's content: one personal deck with five new cards. */
async function prepareDeck(page: Page, tenant: QaTenant): Promise<Map<string, string>> {
  const deckId = await ensureDeck(page, deckName(tenant));
  return ensureCards(page, deckId);
}

/** The flip container (`FlashcardFlip`'s rotating div). */
function rotatingCard(page: Page): Locator {
  return page.locator('div[style*="preserve-3d"]').first();
}

/** The question face — the container's first child (the answer face is the second). */
function frontFace(page: Page): Locator {
  return rotatingCard(page).locator('div').first();
}

/** The front text of the card currently up (the queue is shuffled, so read it). */
async function shownCard(page: Page): Promise<string> {
  const text = await frontFace(page).innerText();
  const front = CARD_FRONTS.find((candidate) => text.includes(candidate));
  if (!front) {
    throw new Error(
      `no seeded card front in the question face: ${JSON.stringify(text.slice(0, 120))}`,
    );
  }
  return front;
}

async function cardTransform(page: Page): Promise<string> {
  return rotatingCard(page).evaluate((element) => getComputedStyle(element).transform);
}

/**
 * Assert the card is on the question side (`false`) or the answer side (`true`):
 * the 3D rotation is the flip itself, the hint is only rendered while the
 * question side is up. Both are polled so the spring animation can settle.
 */
async function expectFlipped(page: Page, flipped: boolean): Promise<void> {
  const hint = page.getByText(COPY.flipHint, { exact: true });
  if (flipped) {
    await expect
      .poll(() => cardTransform(page), { message: 'card rotated to the answer' })
      .toBe(FLIPPED_TRANSFORM);
    await expect(hint, 'the reveal hint is hidden once the answer is up').toHaveCount(0);
  } else {
    await expect
      .poll(() => cardTransform(page), { message: 'card back on the question' })
      .toBe('none');
    await expect(hint, 'the reveal hint is back on the question side').toBeVisible();
  }
}

test.describe('@case:STU-06 @area:STU @prio:P2 study session keyboard shortcuts', () => {
  test('Space flips the card and 1-4 rate it only after the answer is revealed', async ({
    page,
  }) => {
    const tenant = loadTenant(CASE);
    const student = tenant.users.student;
    if (!student) throw new Error(`${CASE} needs the content tenant profile (student)`);

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // The product's own rating payload: the case's 1 = Again … 4 = Easy mapping
    // is what the session sends to `/flashcards/batch/practice` on exit.
    const batches: PracticeBatch[] = [];
    page.on('request', (request) => {
      if (request.method() !== 'POST') return;
      if (!request.url().endsWith('/api/v1/flashcards/batch/practice')) return;
      batches.push(request.postDataJSON() as PracticeBatch);
    });

    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });
    const cardIds = await prepareDeck(page, tenant);

    // --- Prerequisite: the „Ucz się” page offers the tenant's new cards -----
    await page.goto('/app/study');
    await expect(page).toHaveURL(/\/app\/study(\/learn)?$/);
    await expect(page.getByText(COPY.newCardsTitle, { exact: true })).toBeVisible();
    await expect(page.getByText(COPY.newCardsAvailable, { exact: true })).toBeVisible();

    const queueResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        response.url().includes('/api/v1/flashcards/practice/new'),
    );
    await page.getByRole('button', { name: COPY.startLearning, exact: true }).click();
    const queue = (await (await queueResponse).json()) as ApiEnvelope<{ front: string }[]>;
    expect(
      queue.data.map((card) => card.front).sort(),
      'the session queue is exactly the tenant’s five new cards',
    ).toEqual([...CARD_FRONTS].sort());

    await expect(page).toHaveURL(/\/app\/study\/session\/new/);
    await expect(rotatingCard(page)).toBeVisible();
    // The session listens on `window`; the start button must not keep focus or
    // „Space” would also activate it.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    // --- Step 1: Space flips the card (front ⇄ back) ------------------------
    const firstCard = await shownCard(page);
    await expect(page.getByText(correctBadge(0, 0), { exact: true })).toBeVisible();
    await expectFlipped(page, false);

    await page.keyboard.press('Space');
    await expectFlipped(page, true);

    await page.keyboard.press('Space');
    await expectFlipped(page, false);
    expect(await shownCard(page), 'Space alone does not advance the queue').toBe(firstCard);

    // --- Step 2: the rating keys are inert before the reveal ----------------
    for (const rating of RATINGS) {
      // The buttons advertise the case's mapping (aria-keyshortcuts 1–4).
      const button = page.locator(`button[aria-keyshortcuts="${rating.key}"]`);
      await expect(button).toBeVisible();
      await expect(button).toContainText(rating.label);
    }

    await page.keyboard.press('4');
    await page.waitForTimeout(250);
    await expect(page.getByText(correctBadge(0, 0), { exact: true })).toBeVisible();
    await expectFlipped(page, false);
    expect(await shownCard(page), 'an unrevealed card is not rated or advanced').toBe(firstCard);

    // --- Step 3: the shortcuts panel ---------------------------------------
    // The case accepts a toast or a panel; the session renders a panel (keyboard
    // icon, also toggled with Alt+K) listing Space + 1–4 with their actions.
    await expect(
      page.getByRole('button', { name: COPY.shortcutsTrigger, exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Alt+k');
    const panel = page.locator('[data-slot="hover-card-content"]');
    await expect(panel).toBeVisible();
    await expect(panel.locator('kbd')).toHaveText(['Space', 'p', '1', '2', '3', '4']);
    await expect(panel.getByText(COPY.flipAction, { exact: true })).toBeVisible();
    for (const rating of RATINGS) {
      await expect(
        panel.getByText(new RegExp(`^${rating.label}`)),
        `the panel lists key ${rating.key} as „${rating.label}”`,
      ).toBeVisible();
    }
    await page.keyboard.press('Alt+k');
    await expect(panel).toBeHidden();

    // --- Step 4: 1–4 rate consecutive cards after the reveal ---------------
    let correct = 0;
    let total = 0;
    const rated: string[] = [];

    for (const rating of RATINGS) {
      const before = await shownCard(page);
      await page.keyboard.press('Space');
      await expectFlipped(page, true);

      await page.keyboard.press(rating.key);
      total += 1;
      if (rating.wasCorrect) correct += 1;

      // The badge proves the mapping's correctness half (1/2 not remembered,
      // 3/4 remembered) and that the key was accepted.
      await expect(page.getByText(correctBadge(correct, total), { exact: true })).toBeVisible();
      // The session returns to the question side of the next card.
      await expectFlipped(page, false);
      const after = await shownCard(page);
      expect(after, `key ${rating.key} advances to another card`).not.toBe(before);
      rated.push(before);
    }

    // --- Step 5: the ratings reach the API with the case's mapping ---------
    // „Zakończ sesję” flushes the pending practice batch (the same write the
    // 30 s interval would flush), so the payload is deterministic here.
    await page.getByRole('button', { name: COPY.exitSession, exact: true }).click();
    await expect(page).toHaveURL(/\/app\/study(\/learn)?$/);

    const answers = batches.flatMap((batch) => batch.items);
    expect(answers, 'every rated card reached the practice batch').toHaveLength(RATINGS.length);
    expect(
      answers.map((answer) => answer.confidenceLevel),
      'keys 1–4 send the case’s ratings in order',
    ).toEqual(RATINGS.map((rating) => rating.confidenceLevel));
    expect(
      answers.map((answer) => answer.wasCorrect),
      '1/2 are „not remembered”, 3/4 are „remembered”',
    ).toEqual(RATINGS.map((rating) => rating.wasCorrect));
    expect(
      answers.map((answer) => answer.flashcardId),
      'each rating is attached to the card that was up',
    ).toEqual(rated.map((front) => cardIds.get(front)));

    expect(pageErrors, 'uncaught page errors').toEqual([]);
  });
});
