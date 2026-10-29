import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { createQaSupabase } from '@qa/fixtures/qa-db';
import { expect, loadTenant, loginAs, test, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * SEC-13 — Reguły dostępu do bazy (RLS): the anon key reads no user data.
 *
 * Case (verbatim → tenant model): the legacy prerequisite is Supabase Studio or
 * the anon key (`http://127.0.0.1:54323`), and the single step calls PostgREST
 * **with the anon key and no session** — `GET /rest/v1/profiles` and
 * `GET /rest/v1/flashcards`. Expected: no data for an anonymous caller (empty
 * list / 401) because RLS is enabled on the tables that hold user data. Nothing
 * about `@dev.local` accounts or the legacy port is used: the target is this
 * case's own tenant on the shared Supabase (`qa/env.json` → :54421).
 *
 * Tenant (deterministic, `content` profile, fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts SEC-13 --fresh
 *
 * gives org `qa-sec-13-<suffix>` (`tenantKey('qa/cases/SEC-13.md', 'SEC-13#<suffix>',
 * 'qa-shared')` + `tenantId` for every id) with a manager, an educator and a
 * student. The case needs exactly that: real user rows — three `profiles` and a
 * personal deck with one card owned by the student — that an anonymous caller
 * must not be able to read. The deck and card are created through the product API
 * in the student's own session (idempotent by name, so `--repeat-each` / `--retries`
 * on one seeded tenant neither duplicates rows nor depends on leftovers).
 *
 * Acceptance points walked on the shared stack (app :3010, Supabase :54421, worker
 * qa-env-8) on 2026-10-29 with the anon key and no session:
 * 1. `GET /rest/v1/profiles` → **401** `{"code":"42501","message":"permission denied
 *    for table profiles"}` — zero rows, no `email`, no `id`.
 * 2. `GET /rest/v1/flashcards` (and `?id=eq.<card>`, `?deckIds=…`) → **401**
 *    `42501 permission denied for table flashcards` — the deck's card never leaks.
 * 3. `GET /rest/v1/flashcard_decks?id=eq.<deck>` → **401** `42501` as well (the
 *    parent table of a card, same surface).
 * 4. The same anon key still reads the intentionally public pricing tables
 *    (`subscription_plans`) — so the 401s are per-table authorization, not a broken
 *    key or URL.
 * 5. Positive control with the same anon key plus a real user session (GoTrue
 *    password grant, the exact PostgREST path a browser uses): the student reads
 *    their own `profiles` row and the card that anon could not see — the data
 *    exists, the boundary is authorization, not an empty table.
 * 6. `rls_audit()` (service role, catalog metadata only, no tenant rows) reports
 *    `rls_enabled = true` and `anon_select = false` for `profiles`, `flashcards`
 *    and `flashcard_decks`.
 *
 * Nothing global is written: no admin setting, feature flag, plan change, platform
 * stat or singleton row; only this run's own tenant rows are created, and the
 * anonymous reads are read-only.
 */

const CASE = 'SEC-13';
const TENANT: QaTenant = loadTenant(CASE);

/** Run suffix the seeder folded into the tenant key (stable tenants have none). */
const RUN = TENANT.runSuffix ?? 'stable';

const DECK_NAME = `SEC-13 deck ${RUN}`;
const CARD_FRONT = `SEC-13 front ${RUN}`;

/**
 * `supabase start` demo anon key — a publishable key, identical on every local
 * stack (same constant as `scripts/load-test/config.ts`). It is only a fallback:
 * the suite's CI runner can inject the stack's own key through the environment.
 */
const LOCAL_DEMO_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const USER_DATA_TABLES = ['profiles', 'flashcards', 'flashcard_decks'] as const;

interface Envelope<T> {
  success: boolean;
  data: T;
  error?: string;
}

interface Deck {
  id: string;
  name: string;
  created_by: string;
  organization_id: string | null;
  visibility: 'personal' | 'group';
}

interface Flashcard {
  id: string;
  front: string;
  deck_id: string;
}

interface RestResponse {
  status: number;
  body: string;
}

/**
 * The shared Supabase the browser tile and the app actually use. The worker's
 * own `apps/web/.env` may still point at its idle stack, so `qa/env.json` wins
 * for the URL; the anon key is the same demo key everywhere and is taken from the
 * environment when a runner provides it.
 */
function sharedSupabase(): { url: string; anonKey: string } {
  const envFile = join(process.cwd(), 'qa', 'env.json');
  const { supabaseUrl } = JSON.parse(readFileSync(envFile, 'utf8')) as { supabaseUrl?: string };
  if (!supabaseUrl) throw new Error('qa/env.json has no supabaseUrl');
  const anonKey =
    process.env.SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    LOCAL_DEMO_ANON_KEY;
  return { url: supabaseUrl.replace(/\/+$/, ''), anonKey };
}

/** A PostgREST read that carries the anon key as `apikey` and as the bearer token. */
async function restGet(url: string, apikey: string, path: string): Promise<RestResponse> {
  const response = await fetch(`${url}/rest/v1${path}`, {
    headers: { apikey, Authorization: `Bearer ${apikey}`, Accept: 'application/json' },
  });
  return { status: response.status, body: await response.text() };
}

/**
 * The case's expected result: an anonymous caller gets **no data** — either the
 * PostgREST privilege refusal (`401`/`403`, code `42501`) or an empty list. A 200
 * carrying rows is the defect this case guards against.
 */
function expectAnonGetsNothing(response: RestResponse, label: string): void {
  if (response.status === 200) {
    const rows = JSON.parse(response.body) as unknown;
    expect(Array.isArray(rows), `${label}: a 200 must be a JSON array`).toBe(true);
    expect(rows, `${label}: anon must get an empty list`).toEqual([]);
    return;
  }
  expect([401, 403], `${label}: anon status (body: ${response.body})`).toContain(response.status);
  const parsed = JSON.parse(response.body) as { code?: string; message?: string; data?: unknown };
  expect(parsed.code, `${label}: PostgREST refuses the read`).toBe('42501');
  expect(parsed.data, `${label}: an error must not carry rows`).toBeUndefined();
}

/** Real GoTrue password grant with the anon key — the session PostgREST expects. */
async function signIn(
  url: string,
  anonKey: string,
  email: string,
  password: string,
): Promise<string> {
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = (await response.json()) as { access_token?: string };
  if (!response.ok || !body.access_token) {
    throw new Error(`sign-in ${email} failed: ${response.status} ${JSON.stringify(body)}`);
  }
  return body.access_token;
}

/** Unwrap the app's `{ success, data }` envelope and fail the step on a refusal. */
function getData<T>(body: string, label: string): T {
  const parsed = JSON.parse(body) as Envelope<T>;
  expect(parsed.success, `${label}: ${body}`).toBe(true);
  return parsed.data;
}

async function listDecks(page: Page, label: string): Promise<Deck[]> {
  const response = await page.request.get('/api/v1/flashcards/decks?limit=200');
  const body = await response.text();
  expect(response.status(), `${label} GET /api/v1/flashcards/decks: ${body}`).toBe(200);
  return getData<{ items: Deck[] }>(body, label).items;
}

async function listCards(page: Page, deckId: string, label: string): Promise<Flashcard[]> {
  const response = await page.request.get(`/api/v1/flashcards?deckIds=${deckId}&limit=100`);
  const body = await response.text();
  expect(response.status(), `${label} GET /api/v1/flashcards?deckIds=: ${body}`).toBe(200);
  return getData<{ items: Flashcard[] }>(body, label).items;
}

/**
 * The student's personal deck, created through the product API if it is not
 * there yet. Idempotent by name so a retry on the same tenant is a no-op.
 */
async function ensureDeck(page: Page): Promise<Deck> {
  const existing = (await listDecks(page, 'deck lookup')).find((deck) => deck.name === DECK_NAME);
  if (existing) return existing;

  const response = await page.request.post('/api/v1/flashcards/decks', {
    data: { name: DECK_NAME, visibility: 'personal' },
  });
  const body = await response.text();
  expect(response.status(), `POST /api/v1/flashcards/decks: ${body}`).toBe(201);
  return getData<Deck>(body, 'deck create');
}

/** One card in the deck — the flashcard row an anonymous caller must not read. */
async function ensureCard(page: Page, deckId: string): Promise<Flashcard> {
  const existing = (await listCards(page, deckId, 'card lookup')).find(
    (card) => card.front === CARD_FRONT,
  );
  if (existing) return existing;

  const response = await page.request.post('/api/v1/flashcards', {
    data: { deckId, front: CARD_FRONT, back: `${CARD_FRONT} back` },
  });
  const body = await response.text();
  expect(response.status(), `POST /api/v1/flashcards: ${body}`).toBe(201);
  return getData<Flashcard>(body, 'card create');
}

test.describe('@case:SEC-13 @area:SEC @prio:P2 anonymous REST access', () => {
  test('the anon key reads no profile or flashcard row and RLS is on', async ({ page }) => {
    test.setTimeout(120_000);

    const student = TENANT.users.student;
    if (!student || !TENANT.org) {
      throw new Error(`${CASE} needs the content tenant profile (org + student)`);
    }
    const { url, anonKey } = sharedSupabase();

    // --- Step 0: the tenant owns user data that must stay private ------------
    await loginAs(page, TENANT, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });

    const deck = await ensureDeck(page);
    expect(deck.created_by, 'the deck belongs to the tenant student').toBe(student.id);
    expect(deck.visibility, 'the deck is the student’s personal content').toBe('personal');

    const card = await ensureCard(page, deck.id);
    expect(card.deck_id, 'the card lives in the tenant student’s deck').toBe(deck.id);

    console.log(`SEC-13 tenant key: ${TENANT.key}`);
    console.log(`SEC-13 supabase: ${url}`);
    console.log(`SEC-13 private deck: ${deck.id} ${deck.name}`);
    console.log(`SEC-13 private card: ${card.id} ${card.front}`);

    // --- Step 1: the case's anonymous REST read ------------------------------
    const profiles = await restGet(url, anonKey, '/profiles?select=*');
    expectAnonGetsNothing(profiles, 'GET /rest/v1/profiles');
    expect(profiles.body, 'no tenant e-mail in the anon response').not.toContain(student.email);
    expect(profiles.body, 'no tenant profile id in the anon response').not.toContain(student.id);

    const cards = await restGet(url, anonKey, '/flashcards?select=*');
    expectAnonGetsNothing(cards, 'GET /rest/v1/flashcards');
    expect(cards.body, 'no tenant card in the anon response').not.toContain(CARD_FRONT);

    // --- Step 1a: guessing a known id does not help --------------------------
    const ownProfile = await restGet(url, anonKey, `/profiles?id=eq.${student.id}&select=*`);
    expectAnonGetsNothing(ownProfile, 'GET /rest/v1/profiles?id=eq.<student>');
    expect(ownProfile.body).not.toContain(student.email);

    const ownCard = await restGet(url, anonKey, `/flashcards?id=eq.${card.id}&select=*`);
    expectAnonGetsNothing(ownCard, 'GET /rest/v1/flashcards?id=eq.<card>');
    expect(ownCard.body).not.toContain(CARD_FRONT);

    // The parent table of the card is part of the same surface.
    const ownDeck = await restGet(url, anonKey, `/flashcard_decks?id=eq.${deck.id}&select=*`);
    expectAnonGetsNothing(ownDeck, 'GET /rest/v1/flashcard_decks?id=eq.<deck>');
    expect(ownDeck.body).not.toContain(DECK_NAME);

    // --- Step 2: the key itself is valid -------------------------------------
    // The public pricing tables are anon-readable by design; a 200 here proves the
    // refusals above are per-table authorization, not a bad key or a wrong URL.
    const pricing = await restGet(url, anonKey, '/subscription_plans?select=id&limit=1');
    expect(pricing.status, `GET /rest/v1/subscription_plans: ${pricing.body}`).toBe(200);
    expect(Array.isArray(JSON.parse(pricing.body)), 'pricing rows are a JSON array').toBe(true);

    // --- Step 3: positive control — a real user session reads the same rows ---
    const token = await signIn(url, anonKey, student.email, student.password);

    const authedCardResponse = await fetch(
      `${url}/rest/v1/flashcards?id=eq.${card.id}&select=id,front`,
      { headers: { apikey: anonKey, Authorization: `Bearer ${token}` } },
    );
    expect(authedCardResponse.status, 'the student reads their own card').toBe(200);
    const authedCards = (await authedCardResponse.json()) as Array<{ id: string; front: string }>;
    expect(
      authedCards.map((row) => row.id),
      'the card exists and is visible to its owner',
    ).toContain(card.id);
    expect(authedCards.find((row) => row.id === card.id)?.front).toBe(CARD_FRONT);

    const authedProfileResponse = await fetch(
      `${url}/rest/v1/profiles?id=eq.${student.id}&select=id,email`,
      { headers: { apikey: anonKey, Authorization: `Bearer ${token}` } },
    );
    expect(authedProfileResponse.status, 'the student reads their own profile').toBe(200);
    const authedProfiles = (await authedProfileResponse.json()) as Array<{
      id: string;
      email: string;
    }>;
    expect(
      authedProfiles.map((row) => row.id),
      'the profile row exists',
    ).toContain(student.id);
    expect(authedProfiles.find((row) => row.id === student.id)?.email).toBe(student.email);

    // --- Step 4: RLS is enabled on the tables that hold user data -------------
    // `rls_audit()` is the app's own CI/ops guard: catalog metadata only (RLS flag
    // and anon privileges), no tenant rows are read through the service role.
    const audit = await createQaSupabase().rpc('rls_audit');
    expect(audit.error, `rls_audit: ${audit.error?.message ?? ''}`).toBeNull();

    const rows = (audit.data ?? []) as Array<{
      table_name: string;
      rls_enabled: boolean;
      anon_select: boolean;
      anon_insert: boolean;
    }>;
    for (const table of USER_DATA_TABLES) {
      const row = rows.find((entry) => entry.table_name === table);
      if (!row) throw new Error(`rls_audit returned no row for ${table}`);
      expect(row.rls_enabled, `${table}: row level security is enabled`).toBe(true);
      expect(row.anon_select, `${table}: anon has no SELECT privilege`).toBe(false);
      expect(row.anon_insert, `${table}: anon has no INSERT privilege`).toBe(false);
    }
  });
});
