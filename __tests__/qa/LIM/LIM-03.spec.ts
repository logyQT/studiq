import { expect, test, type Locator, type Page } from '@playwright/test';
import { createQaSupabase } from '@qa/fixtures/qa-db';
import { loadTenant, loginAs } from '@qa/fixtures/qa-tenant';

/**
 * LIM-03 — a higher limit after buying a plan.
 *
 * The case was written against the legacy manual seed (`test-student@dev.local`,
 * password `pass`) after LIM-02 lowered the **global** Base limits to 2 and
 * reset the database. A QA-suite spec must not mutate the shared plan catalogue,
 * so the tenant reproduces the same starting point at the real Base cap (10
 * decks, the value LIM-01 documents and `/app/billing` shows):
 *
 *   bun scripts/qa-tenant.ts LIM-03 --fresh   # profile: __tests__/qa/profiles/LIM-03.json
 *
 * `bare`/`student` is the case's TS account: one student, no organization, no
 * group and the free `base` personal plan from `handle_new_user`. Outside an org
 * the personal plan governs the deck limit (#233), so the Spark purchase
 * visibly raises it.
 *
 * Walked on the shared app (pl) before writing this test:
 * - at the Base cap a further deck answers 429 `USAGE_LIMIT_EXCEEDED`, the
 *   create dialog stays open with an error toast (never a blank screen);
 * - buying Spark from `/pricing/student` ends on `/billing/success` and then
 *   `/app`; `/api/v1/me/personal-plan` reports Spark with `max_decks: 50`,
 *   `/app/billing` shows „Maks. talie 50”, and the deck that was just refused is
 *   created without an error.
 *
 * Re-runnability: a purchase cannot be undone through the product, and CI
 * retries against the same tenant. The test therefore normalizes only its own
 * tenant at the start — `users.student`'s `profiles.personal_plan_key` back to
 * `base` and that student's own decks removed through the API — so every
 * attempt runs the same flow a freshly seeded tenant would. No global plan row,
 * admin setting, feature flag or foreign tenant is read or written.
 *
 * Nothing depends on shared mutable data: the plan catalogue is read through
 * the public API, the payment is the simulated one (`4242…`), and every write
 * belongs to this tenant's student.
 */

const CASE = 'LIM-03';

const UI = {
  billingTitle: 'Rozliczenia',
  currentPlan: 'Aktualny plan',
  pricingTitle: 'Wybierz Swój Plan',
  sparkName: 'StudiQ Spark',
  sparkCta: 'Przejdź na Spark',
  summary: 'Podsumowanie zamówienia',
  total: 'Razem',
  cardNumber: 'Numer karty',
  expiry: 'MM/RR',
  cvc: 'CVC',
  cardName: 'Imię i nazwisko na karcie',
  pay: /Zapłać/,
  paymentSucceeded: /Płatność udana! Przekierowywanie/,
  successTitle: 'Zakup udany!',
  newDeck: 'Nowa talia',
  createDeck: 'Utwórz',
  cancel: 'Anuluj',
  deckCreated: 'Talia utworzona',
  maxDecks: 'Maks. talie',
} as const;

/** The simulated card the case uses (a Stripe test number, never charged). */
const CARD = {
  number: '4242424242424242',
  expiry: '1230',
  cvc: '123',
  name: 'Test Student',
} as const;

interface PersonalPlan {
  key: string;
  name: string;
  limits: Record<string, number>;
}

interface DeckItem {
  id: string;
  name: string;
}

interface DeckList {
  items: DeckItem[];
  total: number;
}

async function personalPlan(page: Page): Promise<PersonalPlan> {
  const res = await page.request.get('/api/v1/me/personal-plan');
  expect(res.status(), 'GET /api/v1/me/personal-plan').toBe(200);
  return (await res.json()).data as PersonalPlan;
}

async function decks(page: Page): Promise<DeckList> {
  const res = await page.request.get('/api/v1/flashcards/decks?owner=mine&limit=100');
  expect(res.status(), 'GET /api/v1/flashcards/decks').toBe(200);
  return (await res.json()).data as DeckList;
}

async function deleteOwnDecks(page: Page): Promise<void> {
  for (let pass = 0; pass < 5; pass++) {
    const { items } = await decks(page);
    if (items.length === 0) return;
    for (const deck of items) {
      const res = await page.request.delete(`/api/v1/flashcards/decks/${deck.id}`);
      expect(res.status(), `DELETE /api/v1/flashcards/decks/${deck.id}`).toBe(200);
    }
  }
  throw new Error('decks survived five delete passes');
}

async function createDeck(page: Page, name: string): Promise<void> {
  const res = await page.request.post('/api/v1/flashcards/decks', { data: { name } });
  expect(res.status(), `POST /api/v1/flashcards/decks (${name})`).toBe(201);
}

/** The „Aktualny plan” card, so copy lookups never match the menu or breadcrumb. */
function currentPlanCard(page: Page): Locator {
  return page.locator('[data-slot="card"]').filter({
    has: page.locator('[data-slot="card-title"]', { hasText: UI.currentPlan }),
  });
}

/** One limit row inside the plan card, found by its label. */
function limitRow(card: Locator, label: string): Locator {
  return card
    .locator('div.flex.items-center.justify-between')
    .filter({ has: card.page().getByText(label, { exact: true }) });
}

/** Open the deck dialog on /app/flashcards, submit a name, keep the dialog open. */
async function submitDeckDialog(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: UI.newDeck, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog, 'the create-deck dialog opens').toBeVisible();
  await dialog.getByPlaceholder(/np\. Przygotowanie do egzaminu/).fill(name);
  await dialog.getByRole('button', { name: UI.createDeck, exact: true }).click();
}

test.describe('LIM-03 — the Spark purchase raises the deck limit', () => {
  test('a deck refused on Base is created after buying Spark and billing shows the new limits', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} runs on the bare tenant profile`).toBe('bare');
    expect(tenant.role, `${CASE} needs a bare student`).toBe('student');
    expect(tenant.org, 'the student under test belongs to no organization').toBeNull();
    expect(
      tenant.runSuffix,
      'seed with --fresh: every independent run owns its own student',
    ).toBeTruthy();
    const student = tenant.users.student;
    if (!student) {
      throw new Error(
        `LIM-03 fixture incomplete: run \`bun scripts/qa-tenant.ts ${CASE} --fresh\``,
      );
    }

    // --- Normalize this tenant only (CI retries reuse it) ------------------
    const db = createQaSupabase();
    const reset = await db
      .from('profiles')
      .update({ personal_plan_key: 'base' })
      .eq('id', student.id);
    expect(reset.error, 'reset the tenant student to the seeded Base plan').toBeNull();

    await loginAs(page, tenant, 'student', { locale: 'pl' });
    await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });

    await deleteOwnDecks(page);
    const planBefore = await personalPlan(page);
    expect(planBefore.key, 'the case starts on the free Base plan').toBe('base');
    const baseCap = planBefore.limits.max_decks;
    expect(baseCap, 'Base caps decks at the LIM-01 value').toBe(10);
    await expect((await decks(page)).items, 'the student starts with no decks').toHaveLength(0);

    // --- Precondition: the tenant is already at the Base deck cap ----------
    for (let index = 1; index <= baseCap; index++) {
      await createDeck(page, `QA LIM-03 deck ${index}`);
    }
    const atCap = await decks(page);
    expect(atCap.total, 'the student owns exactly the Base quota').toBe(baseCap);

    // --- Try one more deck on Base: refused, dialog stays readable ---------
    const blockedName = `QA LIM-03 deck ${baseCap + 1}`;
    await page.goto('/app/flashcards');
    await expect(
      page.getByRole('button', { name: UI.newDeck, exact: true }),
      'the flashcards page renders its deck actions',
    ).toBeVisible();
    await submitDeckDialog(page, blockedName);

    await expect(
      page.locator('[data-sonner-toast][data-type="error"]'),
      'the over-limit deck shows a readable error, not a blank screen',
    ).toBeVisible();
    await expect(
      page.getByRole('dialog'),
      'the create dialog stays open after the refused deck',
    ).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: UI.cancel, exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    // The product, not the test, refused it: the plan limit answered 429.
    const refused = await page.request.post('/api/v1/flashcards/decks', {
      data: { name: blockedName },
    });
    expect(refused.status(), 'POST a deck past the Base cap').toBe(429);
    expect((await refused.json()).error, 'the limit error code').toBe('USAGE_LIMIT_EXCEEDED');

    const stillAtCap = await decks(page);
    expect(stillAtCap.total, 'no deck was created over the Base cap').toBe(baseCap);
    expect(
      stillAtCap.items.some((deck) => deck.name === blockedName),
      'the refused deck is not in the list',
    ).toBe(false);

    // --- Step 1 (BIL-03): buy Spark from /pricing/student ------------------
    await page.goto('/pricing/student');
    await expect(page.getByRole('heading', { name: UI.pricingTitle, exact: true })).toBeVisible();
    const sparkCard = page.locator('[data-slot="card"]').filter({ hasText: UI.sparkName });
    await expect(sparkCard, 'one Spark plan card').toHaveCount(1);
    await sparkCard.getByRole('button', { name: UI.sparkCta, exact: true }).click();

    await expect(page).toHaveURL(/\/checkout\?.*plan_id=spark/, { timeout: 20_000 });
    const summary = page.locator('[data-slot="card"]').filter({ hasText: UI.summary });
    await expect(summary, 'the checkout renders the order summary').toBeVisible();
    await expect(summary, 'the summary names Spark').toContainText(UI.sparkName);
    await expect(summary.getByText(UI.total, { exact: true })).toBeVisible();

    await page.getByLabel(UI.cardNumber, { exact: true }).fill(CARD.number);
    await page.getByLabel(UI.expiry, { exact: true }).fill(CARD.expiry);
    await page.getByLabel(UI.cvc, { exact: true }).fill(CARD.cvc);
    await page.getByLabel(UI.cardName, { exact: true }).fill(CARD.name);
    const pay = page.getByRole('button', { name: UI.pay });
    await expect(pay, 'a complete card unlocks „Zapłać”').toBeEnabled();

    const webhookResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/v1/stripe/webhook',
    );
    await pay.click();
    expect((await webhookResponse).status(), 'POST /api/v1/stripe/webhook').toBe(200);

    await expect(page.getByText(UI.paymentSucceeded), 'the payment confirmation').toBeVisible();
    await expect(page, 'the success page follows the confirmation').toHaveURL(
      /\/billing\/success(\?|$)/,
      { timeout: 15_000 },
    );
    await expect(
      page.getByText(UI.successTitle, { exact: true }),
      'the success page greets the buyer',
    ).toBeVisible();
    await expect(page, 'the success page hands over to the student panel').toHaveURL(/\/app$/, {
      timeout: 20_000,
    });

    // Expected result: the personal plan is now Spark, with the higher limits.
    const planAfter = await personalPlan(page);
    expect(planAfter.key, 'the student is on Spark').toBe('spark');
    expect(planAfter.name, 'Spark is the plan the checkout showed').toBe(UI.sparkName);
    expect(planAfter.limits, 'the Spark limits from LIM-01').toMatchObject({
      max_decks: 50,
      max_flashcards: 500,
      max_questions: 200,
    });

    // --- Step 2: the deck refused on Base is created now -------------------
    await page.goto('/app/flashcards');
    await submitDeckDialog(page, blockedName);
    await expect(
      page.getByText(UI.deckCreated, { exact: true }),
      'the deck that was refused on Base is created on Spark',
    ).toBeVisible();
    await expect(page.getByRole('dialog'), 'the dialog closes on success').toBeHidden();
    await expect(
      page.getByRole('heading', { name: blockedName, exact: true }).first(),
      'the new deck is listed',
    ).toBeVisible();

    const raised = await decks(page);
    expect(raised.total, 'the Base cap no longer applies').toBe(baseCap + 1);
    expect(
      raised.items.some((deck) => deck.name === blockedName),
      'the formerly refused deck is in the list',
    ).toBe(true);

    // --- Expected result: the billing page shows the new limits ------------
    await page.goto('/app/billing');
    await expect(
      page.getByRole('heading', { name: UI.billingTitle, exact: true }),
      'the billing page renders',
    ).toBeVisible();
    const planCard = currentPlanCard(page);
    await expect(planCard, 'the current-plan card').toHaveCount(1);
    await expect(
      planCard.locator('[data-slot="card-description"]'),
      'the card names the new plan',
    ).toHaveText(UI.sparkName);
    await expect(planCard.locator('[data-slot="badge"]'), 'the plan is active').toContainText(
      'Aktywny',
    );

    const sparkLimits: Record<string, number> = {
      max_flashcards: 500,
      max_decks: 50,
      max_questions: 200,
    };
    const limitLabels: Record<string, string> = {
      max_flashcards: 'Maks. fiszki',
      max_decks: UI.maxDecks,
      max_questions: 'Maks. pytania',
    };
    for (const [key, value] of Object.entries(sparkLimits)) {
      expect(planAfter.limits[key], `Spark limit ${key}`).toBe(value);
      const row = limitRow(planCard, limitLabels[key]);
      await expect(row, `limit row ${limitLabels[key]}`).toHaveCount(1);
      await expect(row.locator('span').last(), `${key} on the billing card`).toHaveText(
        value.toLocaleString('pl'),
      );
    }

    // Adjacent regression: the raised cap is the plan's, not a one-off bypass.
    await createDeck(page, `QA LIM-03 deck ${baseCap + 2}`);
    await createDeck(page, `QA LIM-03 deck ${baseCap + 3}`);
    const beyond = await decks(page);
    expect(beyond.total, 'decks keep being created under the Spark cap').toBe(baseCap + 3);
  });
});
