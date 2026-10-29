import { expect, test, type Page } from '@playwright/test';
import { createQaSupabase } from '@qa/fixtures/qa-db';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * STU-05 — full flashcard study session (SM-2).
 *
 * Prerequisite (reconciled with the tenant seeder): a signed-in student with a deck
 * of a few cards. The legacy manual seed (`student1@…`, password `pass`, CSV
 * `fiszki_poprawne.csv`) is never used; the case runs on its own tenant, seeded by
 * the suite runner before every independent run:
 *
 *   bun scripts/qa-tenant.ts STU-05 --fresh
 *
 * `__tests__/qa/profiles/STU-05.json` declares the default `content` profile: one
 * organization with a manager (org admin, never used), an educator and the
 * `student` account this case logs in as, plus the default group `G1`
 * (`tenantKey('qa/cases/STU-05.md', 'STU-05#<run>', 'qa-shared')` + `tenantId` for
 * every id). The profile seeds the graph only: the student builds its own deck,
 * `STU-05 <run>` with 8 cards (`Pytanie N <run>` / `Odpowiedz N <run>`), through
 * `POST /api/v1/flashcards/decks` and `POST /api/v1/flashcards` — the same shape as
 * the case's 8-card CSV import. Nothing shared is read or written: no seed content,
 * admin setting, feature flag, plan or singleton row.
 *
 * CI seeds the tenant **once** for the whole case and Playwright reuses it for every
 * retry and every `--repeat-each` pass, so the test first clears the student's own
 * leftovers: its `STU-05 …` deck (deleting a deck cascades its cards, their review
 * state and their practice rows) and its daily new-card counter, which the default
 * 20/day cap would otherwise exhaust on the third study run. Both are this tenant's
 * own rows; no other row is touched.
 *
 * Acceptance points (case STU-05), walked on the shared app before writing this spec:
 * 1. The learn page offers „Rozpocznij naukę” for 8 new cards; the session shows the
 *    „Nowa” state badge, the `correct/total poprawnych` progress counter, the
 *    „Kliknij, aby odkryć odpowiedź” hint and the four learning-mode rating labels
 *    („Nie pamiętam (reset)”, „Trudne (zostań)”, „Dobrze (dalej)”, „Łatwe (zakończ)”).
 * 2. Revealing the card removes the hint; each rating advances to the next card and
 *    the counter moves (4 ratings used once each, in the case's order).
 * 3. Endless mode: exhausting the queue ends on „Sesja zakończona!” with
 *    correct/time/cards-per-minute, the „Wszystko powtórzone!” block plus „W tej
 *    sesji powtórzyłeś wszystkie fiszki z kolejki.”, and only „Powrót do przeglądu”
 *    — the queue is not restarted.
 * 4. Limited mode: after reaching the target the summary offers both „Przeglądaj
 *    ponownie” and „Powrót do przeglądu” (and no „Wszystko powtórzone!” block).
 *
 * The only non-API step is time: the second phase needs due review cards, and the
 * scheduling endpoint has no "make due now" action. The spec ages the
 * `flashcard_review_state` rows it just created — its own tenant's cards, identified
 * by the ids returned from the API — exactly like the invitation-expiry case ages the
 * single row it created (see `qa/fixtures/qa-db.ts`). No other row is touched.
 */

const CASE = 'STU-05';
const DECKS_URL = '/api/v1/flashcards/decks';
const CARD_COUNT = 8;
/** Correct ratings needed in the limited session (review-page target input). */
const TARGET = 3;

/** Polish copy the case quotes verbatim; `NEXT_LOCALE=pl` pins it for the run. */
const UI = {
  newCardsTitle: 'Nowe karty',
  newCardsAvailable: 'nowych kart dostępnych do nauki',
  cardsDue: 'fiszek oczekuje na powtórkę',
  reviewTitle: 'Przegląd',
  startLearning: 'Rozpocznij naukę',
  startReview: 'Rozpocznij Przegląd',
  modeLimited: 'Limitowany',
  stateNew: 'Nowa',
  stateLearning: 'Nauka',
  revealHint: 'Kliknij, aby odkryć odpowiedź',
  stepOne: 'Krok 1',
  ratingAgain: 'Nie pamiętam (reset)',
  ratingHard: 'Trudne (zostań)',
  ratingGood: 'Dobrze (dalej)',
  ratingEasy: 'Łatwe (zakończ)',
  sessionComplete: 'Sesja zakończona!',
  summaryCorrect: 'Poprawne',
  summaryDuration: 'Czas',
  summaryPerMinute: 'Fiszek / min',
  allCaughtUp: 'Wszystko powtórzone!',
  allCaughtUpDesc: 'W tej sesji powtórzyłeś wszystkie fiszki z kolejki.',
  practiceAgain: 'Przeglądaj ponownie',
  backToReview: 'Powrót do przeglądu',
} as const;

/** Plain (non-learning) labels: they must not leak into a learning-mode session. */
const PLAIN_RATINGS = ['Nie pamiętam', 'Trudne', 'Dobrze', 'Łatwe'] as const;
const LEARNING_RATINGS = [UI.ratingAgain, UI.ratingHard, UI.ratingGood, UI.ratingEasy] as const;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface Deck {
  id: string;
  name: string;
}

type QaDb = ReturnType<typeof createQaSupabase>;

/**
 * Reset this case's own artefacts so a retry or a repeat pass on the CI-seeded
 * tenant starts from the case's stated prerequisite: a student with 8 *new* cards.
 *
 * - The run's deck (plus anything an interrupted attempt left under the same
 *   prefix) is deleted through the product API; the schema cascades its cards and
 *   therefore their `flashcard_review_state` and `flashcard_practice` rows.
 * - The daily new-card budget is reset through the suite's service-role client:
 *   each run introduces 8 new cards against the default 20/day cap, and the
 *   product has no endpoint for the counter (only for the daily review goal).
 */
async function resetRunState(page: Page, tenant: QaTenant, db: QaDb): Promise<void> {
  const student = tenant.users.student;
  if (!student) throw new Error(`${CASE} tenant has no seeded student`);

  const listResponse = await page.request.get(`${DECKS_URL}?limit=100`);
  expect(listResponse.status(), `GET ${DECKS_URL}`).toBe(200);
  const list = (await listResponse.json()) as ApiEnvelope<{ items: Deck[] }>;
  for (const deck of list.data.items.filter((item) => item.name.startsWith(`${CASE} `))) {
    const deleted = await page.request.delete(`${DECKS_URL}/${deck.id}`);
    expect(deleted.status(), `DELETE ${DECKS_URL}/${deck.id} (${deck.name})`).toBe(200);
  }

  const settings = await db
    .from('user_study_settings')
    .update({
      new_cards_introduced: 0,
      daily_reset_date: new Date().toISOString().slice(0, 10),
    })
    .eq('user_id', student.id);
  expect(
    settings.error,
    `reset ${CASE} student daily new-card budget: ${settings.error?.message ?? ''}`,
  ).toBeNull();
}

/** The flip card is the only `h-88` pointer target on the session screen. */
function card(page: Page) {
  return page.locator('.h-88.cursor-pointer');
}

function stateBadge(page: Page, label: string) {
  return page.locator('[data-slot="badge"]').filter({ hasText: new RegExp(`^${label}$`) });
}

function summary(page: Page) {
  return page.getByRole('dialog');
}

/** Reveal the answer: the hint must be there first, and must be gone after the flip. */
async function revealAnswer(page: Page): Promise<void> {
  const hint = page.getByText(UI.revealHint, { exact: true });
  await expect(hint).toBeVisible();
  await expect(card(page)).toHaveCount(1);
  await card(page).click();
  await expect(hint).toHaveCount(0);
}

/**
 * The card's own text. Both faces are in the DOM (the flip hides one with
 * `backface-visibility`), and every card in the run has a unique front and back,
 * so a different string means the session swapped in the next card.
 */
async function cardText(page: Page): Promise<string> {
  return (await card(page).textContent())?.trim() ?? '';
}

/** Reveal and rate a card that is not the last one of the queue. */
async function answerCard(page: Page, label: string): Promise<void> {
  const answered = await cardText(page);
  await revealAnswer(page);
  await page.getByRole('button', { name: label, exact: true }).click();
  // The rating unmounts the answered card and springs the next one in. Wait for the
  // replacement to be on screen before touching the card again: clicking while the
  // old node is still on top is a lost click (mousedown lands on it, mouseup after it
  // is gone dispatches no click), which is what made this step flaky under CI load.
  await expect.poll(() => cardText(page), { timeout: 10_000 }).not.toBe(answered);
  // Every non-terminal rating brings the next card, unflipped.
  await expect(page.getByText(UI.revealHint, { exact: true })).toBeVisible();
}

/**
 * Age the review-state rows this run just created so the cards are due now. Returns
 * how many rows were made due; the caller asserts the queue size against it.
 */
async function ageLearningCards(db: QaDb, studentId: string, cardIds: string[]): Promise<number> {
  const { data, error } = await db
    .from('flashcard_review_state')
    .select('flashcard_id, learning_state')
    .eq('user_id', studentId)
    .in('flashcard_id', cardIds);
  expect(error, 'read the run review state').toBeNull();

  const learningIds = (data ?? [])
    .filter((row) => row.learning_state === 'learning')
    .map((row) => row.flashcard_id);
  expect(
    learningIds.length,
    'cards in learning state after the endless session (must cover the limited target)',
  ).toBeGreaterThanOrEqual(TARGET);

  const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { error: updateError } = await db
    .from('flashcard_review_state')
    .update({ next_review_at: past })
    .eq('user_id', studentId)
    .in('flashcard_id', learningIds);
  expect(updateError, 'age the learning cards').toBeNull();

  return learningIds.length;
}

test.describe('STU-05 — full flashcard study session', () => {
  test('walks the endless and limited review paths to their summaries', async ({ page }) => {
    test.setTimeout(240_000);
    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} runs on the content profile`).toBe('content');
    expect(
      tenant.runSuffix,
      'seed with --fresh: every independent run owns a new tenant',
    ).toBeTruthy();
    const student = tenant.users.student;
    expect(student, `${CASE} seeds the student under test`).toBeTruthy();
    expect(tenant.org, 'the student under test belongs to the tenant organization').toBeTruthy();
    if (!student) throw new Error(`${CASE} tenant has no seeded student`);

    // Content names carry the run suffix, so two seeded tenants never collide.
    const run = tenant.runSuffix ?? tenant.key.slice(-6);
    const deckName = `${CASE} ${run}`;
    const cards = Array.from({ length: CARD_COUNT }, (_, index) => ({
      front: `Pytanie ${index + 1} ${run}`,
      back: `Odpowiedz ${index + 1} ${run}`,
    }));

    const db = createQaSupabase();

    // ── Precondition: the case's tenant student, with no cards of its own yet ──
    await loginAs(page, tenant, 'student', { locale: 'pl' });
    await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });
    // A retry or a repeat pass reuses this tenant: drop what the previous pass left.
    await resetRunState(page, tenant, db);

    // --- The case's deck: 8 cards, created through the product API ----------
    const deckResponse = await page.request.post(DECKS_URL, { data: { name: deckName } });
    expect(deckResponse.status(), `create deck ${deckName}`).toBe(201);
    const deckId = ((await deckResponse.json()) as ApiEnvelope<{ id: string }>).data.id;

    const cardIds: string[] = [];
    for (const cardContent of cards) {
      const created = await page.request.post('/api/v1/flashcards', {
        data: { deckId, ...cardContent },
      });
      expect(created.status(), `create card ${cardContent.front}`).toBe(201);
      cardIds.push(((await created.json()) as ApiEnvelope<{ id: string }>).data.id);
    }
    expect(cardIds).toHaveLength(CARD_COUNT);

    // --- Step 1: the learn page offers a new-card session --------------------
    await page.goto('/app/study/learn');
    const newCardsCard = page.locator('[data-slot="card"]').filter({ hasText: UI.newCardsTitle });
    await expect(
      newCardsCard.locator('[data-slot="card-title"]').filter({ hasText: UI.newCardsTitle }),
    ).toBeVisible();
    // The counter is its own line above the plural label.
    await expect(newCardsCard.getByText(String(CARD_COUNT), { exact: true })).toBeVisible();
    await expect(newCardsCard.getByText(UI.newCardsAvailable, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: UI.startLearning, exact: true }).click();
    await expect(page).toHaveURL(/\/app\/study\/session\/new\?studyMode=endless$/);

    // --- Step 2-3: badge, counter, hint and the four learning-mode ratings ---
    await expect(stateBadge(page, UI.stateNew)).toBeVisible();
    await expect(page.getByText('0/0 poprawnych', { exact: true })).toBeVisible();
    await expect(page.getByText(UI.revealHint, { exact: true })).toBeVisible();
    await expect(page.getByText(UI.stepOne, { exact: true })).toBeVisible();
    for (const label of LEARNING_RATINGS) {
      await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
    }
    for (const label of PLAIN_RATINGS) {
      await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0);
    }

    // One card per rating, in the case's order: again, hard, good, easy.
    const rated = [
      { label: UI.ratingAgain, correct: 0, answered: 1 },
      { label: UI.ratingHard, correct: 0, answered: 2 },
      { label: UI.ratingGood, correct: 1, answered: 3 },
      { label: UI.ratingEasy, correct: 2, answered: 4 },
    ];
    for (const step of rated) {
      await answerCard(page, step.label);
      await expect(
        page.getByText(`${step.correct}/${step.answered} poprawnych`, { exact: true }),
      ).toBeVisible();
    }

    // --- Step 4: finish the queue; the remaining cards are answered "good" ---
    for (const step of [
      { correct: 3, answered: 5 },
      { correct: 4, answered: 6 },
      { correct: 5, answered: 7 },
    ]) {
      await answerCard(page, UI.ratingGood);
      await expect(
        page.getByText(`${step.correct}/${step.answered} poprawnych`, { exact: true }),
      ).toBeVisible();
    }

    await revealAnswer(page);
    await page.getByRole('button', { name: UI.ratingGood, exact: true }).click();

    // Endless mode exhausted the queue: summary + "all caught up", no re-run.
    const endlessSummary = summary(page);
    await expect(endlessSummary).toBeVisible();
    await expect(endlessSummary.getByText(UI.sessionComplete, { exact: true })).toBeVisible();
    await expect(endlessSummary.getByText('6 z 8 poprawnych', { exact: true })).toBeVisible();
    await expect(endlessSummary.getByText(UI.summaryCorrect, { exact: true })).toBeVisible();
    await expect(endlessSummary.getByText('6/8', { exact: true })).toBeVisible();
    await expect(endlessSummary.getByText(UI.summaryDuration, { exact: true })).toBeVisible();
    await expect(endlessSummary.getByText(/^\d+:\d{2}$/)).toBeVisible();
    await expect(endlessSummary.getByText(UI.summaryPerMinute, { exact: true })).toBeVisible();
    await expect(endlessSummary.getByText(/^\d+\.\d$/)).toBeVisible();
    await expect(endlessSummary.getByText(UI.allCaughtUp, { exact: true })).toBeVisible();
    await expect(endlessSummary.getByText(UI.allCaughtUpDesc, { exact: true })).toBeVisible();
    await expect(
      endlessSummary.getByRole('button', { name: UI.practiceAgain, exact: true }),
    ).toHaveCount(0);

    await endlessSummary.getByRole('button', { name: UI.backToReview, exact: true }).click();
    await expect(page).toHaveURL(/\/app\/study\/learn$/);

    // --- Limited mode: the same tenant, now with due review cards ------------
    // The session writes its answers in batches; wait for all 8 to be persisted
    // before touching the schedule, so no write can land after the aging update.
    await expect
      .poll(
        async () => {
          const response = await page.request.get('/api/v1/flashcards/practice/states');
          const body = (await response.json()) as {
            data: { practicedCards: number };
          };
          return body.data.practicedCards;
        },
        { timeout: 20_000 },
      )
      .toBe(CARD_COUNT);

    const dueCount = await ageLearningCards(db, student.id, cardIds);
    await expect
      .poll(
        async () => {
          const response = await page.request.get('/api/v1/flashcards/practice/due/count');
          const body = (await response.json()) as { data: { count: number } };
          return body.data.count;
        },
        { timeout: 20_000 },
      )
      .toBe(dueCount);

    await page.goto('/app/study/learn');
    const reviewCard = page.locator('[data-slot="card"]').filter({ hasText: UI.reviewTitle });
    await expect(
      reviewCard.locator('[data-slot="card-title"]').filter({ hasText: UI.reviewTitle }),
    ).toBeVisible();
    await expect(reviewCard.getByText(String(dueCount), { exact: true })).toBeVisible();
    await expect(reviewCard.getByText(UI.cardsDue, { exact: true })).toBeVisible();

    await page
      .locator('[data-slot="toggle-group-item"]')
      .filter({ hasText: UI.modeLimited })
      .click();
    await page.locator('input[type="number"]').fill(String(TARGET));
    await expect(page.getByText(`Cel: ${TARGET} poprawnych`, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: UI.startReview, exact: true }).click();
    await expect(page).toHaveURL(
      new RegExp(`/app/study/session/review\\?studyMode=limited&target=${TARGET}$`),
    );

    // Review cards from the endless session are in learning state: same labels.
    await expect(stateBadge(page, UI.stateLearning)).toBeVisible();
    await expect(page.getByText('0/0 poprawnych', { exact: true })).toBeVisible();
    await expect(page.getByText(`0/${TARGET} zapamiętanych`, { exact: true })).toBeVisible();
    await expect(page.getByText(UI.revealHint, { exact: true })).toBeVisible();
    for (const label of LEARNING_RATINGS) {
      await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
    }
    for (const label of PLAIN_RATINGS) {
      await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0);
    }

    for (let answered = 1; answered < TARGET; answered++) {
      await answerCard(page, UI.ratingGood);
      await expect(
        page.getByText(`${answered}/${answered} poprawnych`, { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(`${answered}/${TARGET} zapamiętanych`, { exact: true }),
      ).toBeVisible();
    }
    await revealAnswer(page);
    await page.getByRole('button', { name: UI.ratingGood, exact: true }).click();

    // Limited mode reached its target: both buttons, no queue-exhausted block.
    const limitedSummary = summary(page);
    await expect(limitedSummary).toBeVisible();
    await expect(limitedSummary.getByText(UI.sessionComplete, { exact: true })).toBeVisible();
    await expect(
      limitedSummary.getByText(`${TARGET} z ${TARGET} poprawnych`, { exact: true }),
    ).toBeVisible();
    await expect(limitedSummary.getByText(UI.summaryCorrect, { exact: true })).toBeVisible();
    await expect(limitedSummary.getByText(`${TARGET}/${TARGET}`, { exact: true })).toBeVisible();
    await expect(limitedSummary.getByText(UI.summaryDuration, { exact: true })).toBeVisible();
    await expect(limitedSummary.getByText(/^\d+:\d{2}$/)).toBeVisible();
    await expect(limitedSummary.getByText(UI.summaryPerMinute, { exact: true })).toBeVisible();
    await expect(limitedSummary.getByText(/^\d+\.\d$/)).toBeVisible();
    await expect(
      limitedSummary.getByRole('button', { name: UI.practiceAgain, exact: true }),
    ).toBeVisible();
    await expect(limitedSummary.getByText(UI.allCaughtUp, { exact: true })).toHaveCount(0);

    await limitedSummary.getByRole('button', { name: UI.backToReview, exact: true }).click();
    await expect(page).toHaveURL(/\/app\/study\/learn$/);
  });
});
