import { expect, type Page, test } from '@playwright/test';
import { z } from 'zod';
import { fakeLlm, rolesOf, toolArgumentsOf, wasStreamed } from '#test/qa/AI/fake-llm';
import { loadTenant, loginAs } from '#test/qa/fixtures/tenant';

/**
 * STU-48 — Czat AI – generowanie fiszek i zapis do talii (`/app/ai`).
 *
 * Case: ask for flashcards, drop one card from the preview, save the rest as a
 * deck and open it. The model is the fake inference server (`bun run mock:llm`),
 * which also lets the suite feed the chat what a real model sometimes does
 * wrong. Fixtures: `scripts/fake-llm/cases/STU-48.*.json`.
 *
 * Tenant: `bun scripts/qa-tenant.ts STU-48 --fresh` (`content` profile on the
 * `hub` plan, a finite daily AI budget). The spec signs in as `users.student`.
 *
 * Reconciliation (walk on the app, 2026-11-15):
 * - The case expects the statuses „Analizuję tematy… / Generuję fiszki… /
 *   Organizuję w talie…” while generating. They exist as messages
 *   (`AiChatPage.status_*`) but no component renders them, so nothing asserts them.
 * - The case expects the deck „AI Wygenerowane Fiszki”. That is only the
 *   fallback of the name field; the generation tool always names the deck
 *   („Generated Flashcards” when the model gives none), so the name the
 *   fixture chose is the one the deck gets.
 * - The case expects the toast „Talia utworzona z N fiszkami”; saving into a new
 *   deck does fire that toast (`flashcard_deck_created`). The spec asserts the
 *   inline saved panel instead, `flashcard_saved` („Zapisano N fiszki do talii”),
 *   which is the string that stays on screen. The save copy and the generated
 *   header inflect (1 fiszkę / 2 fiszki / 5 fiszek); the read-only ask-user
 *   preview (`flashcards_preview`) still does not.
 * - Behaviour pinned as it is today, not as it should be: a nested model call
 *   (`fetch_material`) is never metered, a call with truncated or unknown tool
 *   input is fed back to the model as a tool error with no UI of its own, and
 *   prose where the model should have called the tool produces no cards.
 */

const CASE = 'STU-48';

const decksSchema = z.object({
  data: z.object({ items: z.array(z.object({ id: z.string(), name: z.string() })) }),
});
const cardsSchema = z.object({
  data: z.object({ items: z.array(z.object({ front: z.string(), back: z.string() })) }),
});

async function openChat(page: Page): Promise<void> {
  await loginAs(page, loadTenant(CASE), 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });
  await page.goto('/app/ai');
  await expect(page.getByPlaceholder('Zapytaj Q')).toBeVisible();
}

async function send(page: Page, text: string): Promise<void> {
  await page.getByPlaceholder('Zapytaj Q').fill(text);
  await page.getByRole('button', { name: /^Wyślij/ }).click();
}

async function deckNames(page: Page): Promise<string[]> {
  const response = await page.request.get('/api/v1/flashcards/decks');
  expect(response.ok()).toBe(true);
  return decksSchema.parse(await response.json()).data.items.map((deck) => deck.name);
}

/** The tokens used today, read from the badge's label („N/200000 tokenów AI …”). */
async function usedTokens(page: Page): Promise<number> {
  const label = await page
    .getByLabel(/tokenów AI wykorzystanych dzisiaj/)
    .getAttribute('aria-label');
  const used = label?.split('/')[0];
  if (used === undefined || !Number.isInteger(Number(used))) {
    throw new Error(`no token counter in the label "${label}"`);
  }
  return Number(used);
}

const saveButton = (page: Page) => page.getByRole('button', { name: /^Zapisz \d+ fisz/ });

test.describe('@case:STU-48 @area:STU @prio:P2 AI chat flashcard generation', () => {
  test.beforeEach(async () => {
    await fakeLlm.reset();
  });

  test('generates five cards, drops one, saves the rest as a deck and opens it', async ({
    page,
  }) => {
    await openChat(page);
    await send(page, 'Stwórz 5 fiszek o układzie słonecznym');

    await expect(page.getByText('Wygenerowano 5 fiszek')).toBeVisible();
    for (const front of ['Merkury', 'Jowisz', 'Droga Mleczna', 'Saturn', 'Księżyc']) {
      await expect(page.getByText(front, { exact: true })).toBeVisible();
    }
    await expect(page.getByPlaceholder('AI Wygenerowane Fiszki')).toHaveValue('Układ Słoneczny');

    // Drop the last card, keep four.
    await page.getByTitle('Usuń kartę').last().click();
    await expect(saveButton(page)).toHaveText('Zapisz 4 fiszki jako talię');
    await saveButton(page).click();

    await expect(page.getByText('Zapisano 4 fiszki do talii')).toBeVisible();
    const open = page.getByRole('link', { name: 'Otwórz talię' });
    const href = await open.getAttribute('href');
    expect(href).toMatch(/^\/app\/flashcards\/[0-9a-f-]{36}$/);

    // The link opens the saved deck: its name on the page, the four kept cards behind it.
    await page.goto(href ?? '');
    await expect(page.getByText('Układ Słoneczny').first()).toBeVisible();
    const deckId = href?.split('/').pop() ?? '';
    const cards = await page.request.get(`/api/v1/flashcards?deckIds=${deckId}`);
    expect(
      cardsSchema
        .parse(await cards.json())
        .data.items.map((card) => card.back)
        .toSorted(),
    ).toEqual(['Droga Mleczna', 'Jowisz', 'Merkury', 'Saturn']);

    // generate, then finish; the second request carries the tool result back
    const requests = await fakeLlm.requestsOf('STU-48:direct-flashcards');
    expect(requests.map((entry) => entry.turn)).toEqual([0, 1]);
    const second = requests[1];
    expect(second && rolesOf(second).at(-1)).toBe('tool');
  });

  test('follows a plan through a nested material call, which is not metered today', async ({
    page,
  }) => {
    await openChat(page);
    const before = await usedTokens(page);

    await send(page, 'Przygotuj fiszki o fotosyntezie z materiału');
    await expect(page.getByText('Wygenerowano 2 fiszki')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Chloroplast', { exact: true })).toBeVisible();
    await expect(page.getByText('Chlorofil', { exact: true })).toBeVisible();

    // The preview can render before the last continuation request reaches the server.
    await expect
      .poll(async () => (await fakeLlm.requestsOf('STU-48:plan-path')).length, { timeout: 10_000 })
      .toBe(5);
    const requests = await fakeLlm.journal();
    const outer = requests.filter((entry) => entry.fixture === 'STU-48:plan-path');
    const nested = requests.filter((entry) => entry.fixture === 'STU-48:plan-material');
    expect(outer.map((entry) => entry.turn)).toEqual([0, 1, 2, 3, 4]);
    expect(outer.every((entry) => wasStreamed(entry))).toBe(true);
    expect(nested).toHaveLength(1);
    expect(nested.every((entry) => wasStreamed(entry))).toBe(false);

    // The five streamed turns report 1 160 + 320 + 580 + 790 + 940 = 2 830 tokens; the
    // nested call's 2 000 never reach the daily counter. If metering is fixed, this
    // number changes by design.
    await expect.poll(() => usedTokens(page)).toBe(before + 2830);
  });

  test('feeds a truncated tool call back to the model and creates nothing', async ({ page }) => {
    await openChat(page);
    const decksBefore = await deckNames(page);

    await send(page, 'Fiszki o planetach, ucięte argumenty');
    await expect(page.getByText('Spróbuję inaczej. Podaj proszę temat jeszcze raz.')).toBeVisible();

    await expect(saveButton(page)).toHaveCount(0);
    expect(await deckNames(page)).toEqual(decksBefore);
    const requests = await fakeLlm.requestsOf('STU-48:truncated-args');
    expect(requests).toHaveLength(2);
    // What reached the app is the cut-off start of the arguments, not valid JSON.
    const [args] = requests[0] ? toolArgumentsOf(requests[0]) : [];
    expect(args).toMatch(/^\{"task":"planety"/);
    expect(() => {
      JSON.parse(args ?? '');
    }).toThrow();
    expect(requests[1] && rolesOf(requests[1]).at(-1)).toBe('tool');
  });

  test('lets the model correct a call to a tool that does not exist', async ({ page }) => {
    await openChat(page);
    await send(page, 'Fiszki o planetach, nieznane narzędzie');

    await expect(page.getByText('Wygenerowano 2 fiszki')).toBeVisible();
    await expect(page.getByText('Najmniejsza planeta Układu Słonecznego')).toBeVisible();
    const requests = await fakeLlm.requestsOf('STU-48:unknown-tool');
    expect(requests.map((entry) => entry.turn)).toEqual([0, 1, 2]);
  });

  test('shows prose as it is when the model answers without calling the tool', async ({ page }) => {
    await openChat(page);
    const decksBefore = await deckNames(page);

    await send(page, 'Fiszki o planetach, sama odpowiedź tekstowa');
    await expect(page.getByText('Oto fiszki: 1) Merkury to najmniejsza planeta.')).toBeVisible();

    await expect(saveButton(page)).toHaveCount(0);
    await expect(page.getByText(/Wygenerowano \d+ fisz/)).toHaveCount(0);
    expect(await deckNames(page)).toEqual(decksBefore);
  });

  test('stops a runaway tool loop at the step cap without an error', async ({ page }) => {
    await openChat(page);
    await send(page, 'Fiszki o planetach, pętla wywołań');

    // `stopWhen: stepCountIs(30)` ends the loop silently: one request per step.
    await expect.poll(async () => (await fakeLlm.journal()).length, { timeout: 20_000 }).toBe(30);
    await expect(page.getByText('Ile planet ma Układ Słoneczny?')).toBeVisible();
    await expect(page.getByText('Nie udało się wysłać wiadomości')).toHaveCount(0);
    expect(await fakeLlm.journal()).toHaveLength(30);
  });

  const failures = [
    {
      name: 'a stream that breaks with a provider error',
      text: 'Fiszki o planetach, błąd w trakcie strumienia',
      fixture: 'STU-48:mid-stream-error',
      requests: 1,
    },
    {
      name: 'a connection that is cut midway',
      text: 'Fiszki o planetach, zerwane połączenie',
      fixture: 'STU-48:disconnect',
      requests: 1,
    },
    {
      // the SDK retries a 5xx twice, 2 s and 4 s apart
      name: 'a provider that is down',
      text: 'Fiszki o planetach, awaria dostawcy',
      fixture: 'STU-48:provider-error',
      requests: 3,
    },
  ];

  for (const failure of failures) {
    test(`reports ${failure.name} and creates nothing`, async ({ page }) => {
      await openChat(page);
      const decksBefore = await deckNames(page);

      await send(page, failure.text);
      await expect(page.getByText('Nie udało się wysłać wiadomości')).toBeVisible({
        timeout: 20_000,
      });
      await expect(saveButton(page)).toHaveCount(0);

      const requests = await fakeLlm.requestsOf(failure.fixture);
      expect(requests).toHaveLength(failure.requests);
      expect(await deckNames(page)).toEqual(decksBefore);
    });
  }
});
