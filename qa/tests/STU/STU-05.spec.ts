import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { tenantKey } from '#test/e2e/fixtures/ids';
import {
  buildAccount,
  createSeedDb,
  randomTag,
  seedTenantGraph,
  tenantId,
  type SeedAccount,
  type SeedDb,
} from '#test/helpers/tenant-seed';

/**
 * STU-05 — full flashcard study session (SM-2).
 *
 * Prerequisite (reconciled with the tenant seeder): a signed-in student with a deck
 * of a few cards. The legacy manual seed (`student1@dev.local`, password `pass`, CSV
 * `fiszki_poprawne.csv`) is never used: the spec seeds its own tenant and builds its
 * own deck through the product API, so it is self-contained and touches no other
 * tenant, plan, flag or singleton row.
 *
 * - Tenant key: `tenantKey('qa/cases/STU-05.md', 'STU-05 full flashcard study
 *   session#<run>', 'qa-shared')` — the same `tenantKey`/`tenantId` scheme as the e2e
 *   fixtures, with a fresh run suffix per independent run (`QA_RUN_SUFFIX` pins one).
 * - Org `qa-stu-05-<run>`: one manager (org admin, never used) and one student
 *   (`Seed4Test!`). The student creates deck `STU-05 <run>` with 8 cards
 *   (`Pytanie N <run>` / `Odpowiedz N <run>`) through `POST /api/v1/flashcards/decks`
 *   and `POST /api/v1/flashcards`, the same shape as the case's 8-card CSV import.
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

const CASE_FILE = 'qa/cases/STU-05.md';
const TITLE = 'STU-05 full flashcard study session';
const PROJECT = 'qa-shared';
const RUN_SUFFIX = process.env.QA_RUN_SUFFIX ?? `${Date.now().toString(36)}-${randomTag(4)}`;
const KEY = tenantKey(CASE_FILE, `${TITLE}#${RUN_SUFFIX}`, PROJECT);
const DECK_NAME = `STU-05 ${RUN_SUFFIX}`;
const CARD_COUNT = 8;
/** Correct ratings needed in the limited session (review-page target input). */
const TARGET = 3;
const CARDS = Array.from({ length: CARD_COUNT }, (_, index) => ({
  front: `Pytanie ${index + 1} ${RUN_SUFFIX}`,
  back: `Odpowiedz ${index + 1} ${RUN_SUFFIX}`,
}));

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

/** Supabase local defaults (the service-role JWT is the public `supabase start` demo key). */
const LOCAL_SUPABASE_URL = 'http://localhost:54421';
const LOCAL_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

/**
 * Resolve the shared Supabase admin credentials. The worker's `qa/env.json` wins over
 * `process.env`: the repository `.env` names the per-slot stack, which is not running
 * in the shared QA setup, and `bun` auto-loads it.
 */
function resolveSupabase(): { url: string; serviceKey: string } {
  let fromEnvJson: string | undefined;
  try {
    const raw = readFileSync(join(process.cwd(), 'qa', 'env.json'), 'utf8');
    fromEnvJson = (JSON.parse(raw) as { supabaseUrl?: string }).supabaseUrl;
  } catch {
    // qa/env.json is worker-local and gitignored; absence is fine.
  }

  return {
    url: process.env.QA_SUPABASE_URL ?? fromEnvJson ?? LOCAL_SUPABASE_URL,
    serviceKey:
      process.env.QA_SUPABASE_SERVICE_ROLE_KEY ??
      process.env.SUPABASE_SERVICE_ROLE_KEY ??
      LOCAL_SERVICE_ROLE_KEY,
  };
}

interface Stu05Tenant {
  key: string;
  student: SeedAccount;
  orgId: string;
  db: SeedDb;
}

/** The case's own org with one student member; no content, the spec creates the deck. */
async function seedCaseTenant(): Promise<Stu05Tenant> {
  const manager = buildAccount(KEY, 'manager', 'manager', { name: `STU-05 manager ${RUN_SUFFIX}` });
  const student = buildAccount(KEY, 'student', 'student', { name: `STU-05 student ${RUN_SUFFIX}` });
  const { url, serviceKey } = resolveSupabase();
  const db = createSeedDb({ url, serviceKey });

  const seeded = await seedTenantGraph(db, {
    key: KEY,
    org: { id: tenantId(KEY, 'org'), name: `qa-stu-05-${RUN_SUFFIX}` },
    defaultGroup: { id: tenantId(KEY, 'group:default'), name: 'G1', isDefault: true },
    extraGroups: [],
    owner: manager,
    members: [student],
    ownerOrgRole: 'admin',
  });

  return { key: KEY, student: seeded.members[0], orgId: seeded.orgId!, db };
}

/**
 * Real login through the API, the real org switch, then boot the app with the Polish
 * locale the case's copy is written in. Logs any previous persona out first so the run
 * can never inherit a session from another case in this worker.
 */
async function signInAs(
  page: Page,
  baseURL: string,
  account: SeedAccount,
  orgId: string,
): Promise<void> {
  await page.request.post('/api/v1/auth/logout');

  const response = await page.request.post('/api/v1/auth/login', {
    data: { email: account.email, password: account.password },
  });
  expect(response.status(), `login ${account.email}`).toBe(200);

  const switched = await page.request.post('/api/v1/me/orgs/switch', { data: { orgId } });
  expect(switched.status(), `switch ${account.email} to ${orgId}`).toBe(200);

  const { hostname } = new URL(baseURL);
  await page
    .context()
    .addCookies([{ name: 'NEXT_LOCALE', value: 'pl', domain: hostname, path: '/' }]);

  await page.goto('/app');
  await expect(page).toHaveURL(/\/(app|edu|manage)(\/|$)/, { timeout: 30_000 });
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

/** Reveal and rate a card that is not the last one of the queue. */
async function answerCard(page: Page, label: string): Promise<void> {
  await revealAnswer(page);
  await page.getByRole('button', { name: label, exact: true }).click();
  // Every non-terminal rating brings the next card, unflipped.
  await expect(page.getByText(UI.revealHint, { exact: true })).toBeVisible();
}

/**
 * Age the review-state rows this run just created so the cards are due now. Returns
 * how many rows were made due; the caller asserts the queue size against it.
 */
async function ageLearningCards(db: SeedDb, studentId: string, cardIds: string[]): Promise<number> {
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
  test('walks the endless and limited review paths to their summaries', async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000);
    const baseURL = testInfo.project.use.baseURL ?? 'http://localhost:3010';
    const tenant = await seedCaseTenant();

    await signInAs(page, baseURL, tenant.student, tenant.orgId);

    // --- The case's deck: 8 cards, created through the product API ----------
    const deckResponse = await page.request.post('/api/v1/flashcards/decks', {
      data: { name: DECK_NAME },
    });
    expect(deckResponse.status(), `create deck ${DECK_NAME}`).toBe(201);
    const deckId = ((await deckResponse.json()) as { data: { id: string } }).data.id;

    const cardIds: string[] = [];
    for (const cardContent of CARDS) {
      const created = await page.request.post('/api/v1/flashcards', {
        data: { deckId, ...cardContent },
      });
      expect(created.status(), `create card ${cardContent.front}`).toBe(201);
      cardIds.push(((await created.json()) as { data: { id: string } }).data.id);
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
          const body = (await response.json()) as { data: { practicedCards: number } };
          return body.data.practicedCards;
        },
        { timeout: 20_000 },
      )
      .toBe(CARD_COUNT);

    const dueCount = await ageLearningCards(tenant.db, tenant.student.id, cardIds);
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
