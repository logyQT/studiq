import { expect, test, type Page } from '@playwright/test';
import { createQaSupabase } from '@qa/fixtures/qa-db';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * STU-04 — the "Ucz się" page shows the right study state and the mode switch.
 *
 * Legacy prerequisite (`student1@dev.local`, decks O1G1T1/O1S1) is replaced by the
 * case's own tenant:
 *
 *   bun scripts/qa-tenant.ts STU-04 --fresh
 *
 * `qa/tests/profiles/STU-04.json` declares the `content` shape: an organization
 * with a manager, a teacher and a student. The student owns the content for this
 * case: the spec creates a deck with 20 cards through the flashcard API, so the
 * first visit shows the "new cards" state. It then reviews two of those cards,
 * ages only its own two review-state rows five minutes into the past (the product
 * schedules a failed card one minute out and has no "make due" action), and
 * re-opens the page to assert the "review" state, both mode descriptions and the
 * target setter.
 *
 * The manual plan calls the target setter a slider ("suwak"); the shipped control
 * is a numeric input. Both express the same requirement — a target control
 * labelled "Cel: N poprawnych" — so the assertions cover the label/value contract,
 * not the widget class. Every user/org id comes from the tenant fixture; the only
 * row this spec writes outside the API is the `next_review_at` of the two review
 * states it just created.
 */

const CASE = 'STU-04';
const NEW_CARDS = 20;
const REVIEWED_CARDS = 2;

/** Polish copy from `AppFlashcardStudyPage` and the case text. */
const COPY = {
  reviewTitle: 'Przegląd',
  reviewDesc: 'Powtarzaj fiszki z powtórkami rozłożonymi w czasie',
  learnTitle: 'Nowe karty',
  learnDesc: 'Skoncentruj się na nauce nowego materiału',
  endless: 'Bez limitu',
  limited: 'Limitowany',
  endlessDesc: 'Kontynuuj aż wszystkie fiszki zostaną przejrane',
  limitedDesc: 'Przeglądaj aż osiągniesz docelową liczbę poprawnych',
  startReview: 'Rozpocznij Przegląd',
  startLearning: 'Rozpocznij naukę',
} as const;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error?: string;
}

interface StudySettings {
  newCardsPerDay: number;
  newCardsIntroduced: number;
  remainingNewCards: number;
  totalNewCards: number;
}

interface CreatedDeck {
  id: string;
}

interface CreatedFlashcard {
  id: string;
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

/** The card that carries `title` (the daily-goal card above it has no such title). */
function studyCard(page: Page, title: string) {
  return page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByText(title, { exact: true }) })
    .first();
}

async function openStudy(page: Page): Promise<void> {
  // Case step 1: `/app/study` is the tab URL and redirects to the "Ucz się" view.
  await page.goto('/app/study');
  await expect(page).toHaveURL(/\/app\/study\/learn$/);
}

test.describe('STU-04 @area:STU @prio:P2 study page states', () => {
  test.setTimeout(60_000);

  test('new-card limit, review counter and the study mode switch', async ({ page }) => {
    const tenant: QaTenant = loadTenant(CASE);
    expect(tenant.profile, 'STU-04 needs the content tenant profile').toBe('content');
    if (!tenant.org || !tenant.users.student) {
      throw new Error('STU-04 fixture incomplete: run `bun scripts/qa-tenant.ts STU-04 --fresh`');
    }
    const student = tenant.users.student;

    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app/ });

    // The case's prerequisite content is created here; the tenant must start
    // empty, otherwise "X of 20 new cards today" would measure a previous run.
    const before = await getJson<StudySettings>(page, '/api/v1/flashcards/practice/settings');
    expect(before.newCardsPerDay, 'default daily budget of new cards').toBe(20);
    expect(
      before.newCardsIntroduced,
      'STU-04 needs a fresh tenant — reseed with `--fresh` (new cards already introduced today)',
    ).toBe(0);
    expect(
      before.totalNewCards,
      'STU-04 needs a fresh tenant — reseed with `--fresh` (cards left from an earlier run)',
    ).toBe(0);

    // --- Seed the case's content through the product API -------------------
    const suffix = tenant.runSuffix ?? tenant.key.slice(-6);
    const deck = await postJson<CreatedDeck>(page, '/api/v1/flashcards/decks', {
      name: `STU-04 ${suffix}`,
    });
    const cardIds: string[] = [];
    for (let index = 0; index < NEW_CARDS; index++) {
      const card = await postJson<CreatedFlashcard>(page, '/api/v1/flashcards', {
        deckId: deck.id,
        front: `STU-04 front ${index + 1}`,
        back: `STU-04 back ${index + 1}`,
      });
      cardIds.push(card.id);
    }
    expect(cardIds).toHaveLength(NEW_CARDS);

    // --- Step 2: no due cards yet → "Nowe karty" with the daily limit bar ---
    await openStudy(page);

    const newCard = studyCard(page, COPY.learnTitle);
    await expect(newCard).toBeVisible();
    await expect(newCard.getByText(COPY.learnDesc, { exact: true })).toBeVisible();

    const settings = await getJson<StudySettings>(page, '/api/v1/flashcards/practice/settings');
    expect(settings.remainingNewCards, 'new cards offered inside the daily budget').toBe(NEW_CARDS);
    expect(newCard.getByText(String(settings.remainingNewCards), { exact: true })).toBeVisible();
    await expect(newCard.getByText(/nowych kart dostępnych do nauki/)).toBeVisible();

    // "0 z 20 nowych kart dzisiaj" and the matching (empty) progress bar.
    await expect(
      newCard.getByText(`0 z ${settings.newCardsPerDay} nowych kart dzisiaj`, { exact: true }),
    ).toBeVisible();
    await expect(newCard.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    await expect(
      newCard.getByRole('button', { name: COPY.startLearning, exact: true }),
    ).toBeVisible();

    // --- Step 2b: review two cards so they become due -----------------------
    const reviewed = cardIds.slice(0, REVIEWED_CARDS);
    for (const cardId of reviewed) {
      await postJson(page, `/api/v1/flashcards/${cardId}/practice`, {
        wasCorrect: false,
        confidenceLevel: 1,
        mode: 'review',
      });
    }

    // The API scheduled both cards one minute out; move just these two rows into
    // the past so the review state is deterministic instead of sleeping.
    const db = createQaSupabase();
    const aged = await db
      .from('flashcard_review_state')
      .update({ next_review_at: new Date(Date.now() - 5 * 60_000).toISOString() })
      .eq('user_id', student.id)
      .in('flashcard_id', reviewed)
      .select('flashcard_id');
    expect(aged.error, `age review state: ${aged.error?.message ?? ''}`).toBeNull();
    expect(aged.data ?? [], 'aged review-state rows').toHaveLength(REVIEWED_CARDS);

    await openStudy(page);
    const due = await getJson<{ count: number }>(page, '/api/v1/flashcards/practice/due/count');
    expect(due.count, 'due cards after the two reviews').toBe(REVIEWED_CARDS);

    // --- Step 2c: "Przegląd" with the due counter ---------------------------
    const reviewCard = studyCard(page, COPY.reviewTitle);
    await expect(reviewCard).toBeVisible();
    await expect(reviewCard.getByText(COPY.reviewDesc, { exact: true })).toBeVisible();
    await expect(reviewCard.getByText(String(due.count), { exact: true })).toBeVisible();
    await expect(reviewCard.getByText('fiszki oczekują na powtórkę')).toBeVisible();

    // --- Step 3: mode switch defaults to "Bez limitu" ----------------------
    const endless = reviewCard.getByRole('radio', { name: COPY.endless, exact: true });
    const limited = reviewCard.getByRole('radio', { name: COPY.limited, exact: true });
    await expect(endless).toHaveAttribute('aria-checked', 'true');
    await expect(limited).toHaveAttribute('aria-checked', 'false');
    await expect(reviewCard.getByText(COPY.endlessDesc, { exact: true })).toBeVisible();
    await expect(reviewCard.getByRole('spinbutton')).toHaveCount(0);

    // --- Step 3b: "Limitowany" changes the description and shows the target -
    await limited.click();
    await expect(limited).toHaveAttribute('aria-checked', 'true');
    await expect(reviewCard.getByText(COPY.limitedDesc, { exact: true })).toBeVisible();

    const target = reviewCard.getByRole('spinbutton');
    await expect(target).toBeVisible();
    const initialTarget = Number(await target.inputValue());
    expect(Number.isInteger(initialTarget) && initialTarget > 0, 'default target').toBe(true);
    await expect(
      reviewCard.getByText(`Cel: ${initialTarget} poprawnych`, { exact: true }),
    ).toBeVisible();

    await target.fill('5');
    await expect(reviewCard.getByText('Cel: 5 poprawnych', { exact: true })).toBeVisible();

    // Switching back hides the target and restores the endless description.
    await endless.click();
    await expect(reviewCard.getByText(COPY.endlessDesc, { exact: true })).toBeVisible();
    await expect(reviewCard.getByRole('spinbutton')).toHaveCount(0);

    // The chosen mode is the one the session starts with — not a decorative switch.
    await limited.click();
    await expect(reviewCard.getByText('Cel: 5 poprawnych', { exact: true })).toBeVisible();
    await reviewCard.getByRole('button', { name: COPY.startReview, exact: true }).click();
    await expect(page).toHaveURL(/\/app\/study\/session\/review\?studyMode=limited&target=5$/);
  });
});
