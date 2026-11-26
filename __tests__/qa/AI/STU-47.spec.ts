import { expect, type Page, test } from '@playwright/test';
import { fakeLlm, wasStreamed } from '#test/qa/AI/fake-llm';
import { loadTenant, loginAs } from '#test/qa/fixtures/tenant';

/**
 * STU-47 — Czat AI – podstawowa rozmowa (`/app/ai`).
 *
 * Case: open the assistant, ask it to explain a concept, watch the streamed
 * answer, stop a long one midway, then start a new conversation and clear the
 * chat. The model is the fake inference server (`bun run mock:llm`), so the
 * answer, its token usage and the reasoning it streams are the fixtures' own:
 *
 *   scripts/fake-llm/cases/STU-47.happy-path.json   reasoning + text, usage 120 + 40
 *   scripts/fake-llm/cases/STU-47.slow-stream.json  13 chunks, 400 ms apart
 *
 * Tenant: `bun scripts/qa-tenant.ts STU-47 --fresh` (`content` profile on the
 * `hub` plan: a finite daily AI budget of 200 000 tokens, which is what makes
 * the counter assertable). The spec signs in as the tenant's `users.student`.
 *
 * Reconciliation (walk on the app, 2026-11-15):
 * - The case expects a counter „X/Y zapytań użytych dzisiaj”. The product meters
 *   **tokens** and labels the badge „X/Y tokenów AI wykorzystanych dzisiaj”
 *   (`AiChatPage.usage_label`); that is what this spec asserts.
 * - „Wyjaśnij pojęcie” on the greeting is a canned local reply, not a model call:
 *   it answers „Jakie pojęcie mam Ci wyjaśnić?” and sends nothing to the model.
 *   The model is only asked when the user types and sends the question, and by
 *   then that canned exchange is part of the history it receives.
 * - The model's reasoning stays server-side (#1210): the route never streams it
 *   (`sendReasoning: false`), so the case's „Pokaż myślenie” toggle is gone.
 *   The fixture still sends a reasoning trace. The route unit test pins the wire
 *   flag; the toggle assertion here catches a client-side render regression.
 */

const CASE = 'STU-47';
const QUESTION = 'Wyjaśnij pojęcie fotosyntezy';

/** The assistant's greeting, shown only while the conversation is empty. */
const GREETING = 'Jak mogę pomóc Ci w nauce?';

/** Tokens of the happy-path fixture: 120 in + 40 out. */
const HAPPY_PATH_TOKENS = 160;

/** The tokens used today, read from the badge's label („N/200000 tokenów AI …”). */
async function usedTokens(page: Page): Promise<number> {
  const badge = page.getByLabel(/tokenów AI wykorzystanych dzisiaj/);
  const label = await badge.getAttribute('aria-label');
  // The badge reads "<used>/<limit> tokenów AI …"; its visible text is "<used>/<limit>".
  const used = label?.split('/')[0];
  if (used === undefined || !Number.isInteger(Number(used))) {
    throw new Error(`no token counter in the label "${label}"`);
  }
  return Number(used);
}

test.describe('@case:STU-47 @area:STU @prio:P2 AI chat basic conversation', () => {
  test.beforeEach(async () => {
    await fakeLlm.reset();
  });

  test('greets, streams an explanation, hides its reasoning and meters the tokens', async ({
    page,
  }) => {
    const tenant = loadTenant(CASE);
    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });
    await page.goto('/app/ai');

    await expect(page.getByText(GREETING)).toBeVisible();
    const input = page.getByPlaceholder('Zapytaj Q');
    await expect(input).toBeVisible();
    await expect(page.getByText('Sztuczna inteligencja może popełniać błędy.')).toBeVisible();

    // The suggestion chip is answered locally; the model is not involved.
    await page.getByRole('button', { name: 'Wyjaśnij pojęcie' }).click();
    await expect(page.getByText('Jakie pojęcie mam Ci wyjaśnić?')).toBeVisible();
    expect(await fakeLlm.journal()).toHaveLength(0);

    // The counter is per tenant and day, so assert the difference this answer makes.
    const before = await usedTokens(page);

    await input.fill(QUESTION);
    await page.getByRole('button', { name: /^Wyślij/ }).click();

    await expect(page.getByText('w glukozę i tlen.')).toBeVisible();
    await expect(page.getByText('Fotosynteza to proces, w którym rośliny')).toBeVisible();

    // The fixture streams the reasoning; the chat must not show it or a toggle.
    await expect(page.getByText('Użytkownik pyta o fotosyntezę.')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Pokaż myślenie' })).toHaveCount(0);

    // Reported by the fixture's usage chunk and counted by the route, which then
    // refreshes the badge.
    await expect.poll(() => usedTokens(page)).toBe(before + HAPPY_PATH_TOKENS);

    const requests = await fakeLlm.journal();
    expect(requests.map((entry) => [entry.fixture, entry.outcome])).toEqual([
      ['STU-47:happy-path', 'ok'],
    ]);
    expect(requests.every((entry) => wasStreamed(entry))).toBe(true);
  });

  test('stops a long answer midway, then clears the chat and starts a new conversation', async ({
    page,
  }) => {
    const tenant = loadTenant(CASE);
    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });
    await page.goto('/app/ai');

    await page.getByPlaceholder('Zapytaj Q').fill('Opowiedz powoli o układzie krążenia');
    await page.getByRole('button', { name: /^Wyślij/ }).click();

    // The stream trickles in; stop it after the first words arrived.
    await expect(page.getByText('Układ krążenia składa się z serca')).toBeVisible();
    await page.getByRole('button', { name: /Zatrzymaj/ }).click();
    await expect(page.getByRole('button', { name: /Zatrzymaj/ })).toBeHidden();
    await expect(page.getByText('który działa bez przerwy.')).toHaveCount(0);

    await page.getByRole('button', { name: 'Wyczyść czat' }).click();
    await expect(page.getByText(GREETING)).toBeVisible();
    await expect(page.getByText('Układ krążenia składa się z serca')).toHaveCount(0);

    await page.getByPlaceholder('Zapytaj Q').fill(QUESTION);
    await page.getByRole('button', { name: /^Wyślij/ }).click();
    await expect(page.getByText('w glukozę i tlen.')).toBeVisible();

    await page.getByRole('button', { name: 'Nowa rozmowa' }).click();
    await expect(page.getByText(GREETING)).toBeVisible();
    await expect(page.getByText('w glukozę i tlen.')).toHaveCount(0);
  });
});
