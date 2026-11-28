import { expect, test, type Page } from '@playwright/test';
import { json } from '#test/helpers/json';
import { loadTenant, loginAs, tenantUser } from '#test/qa/fixtures/tenant';

/**
 * STU-45 — Dostęp do AI zależny od planu (`/app/ai`).
 *
 * Case: as the student S1 on the Free plan (no `ai.chat`), the sidebar has no
 * „Asystent Q” entry; a direct `/app/ai` lands on the locked page, and the AI
 * calls stay limited by the plan (the daily token budget stays 0, so no model is
 * reached).
 *
 * Tenant (deterministic `content` profile, free `launch` org and personal `free`
 * plan — the DB defaults, no `--plan`/`--personal-plan`; one fresh run suffix per
 * independent run):
 *
 *   bun scripts/qa-tenant.ts STU-45 --fresh
 *
 * gives the org `qa-stu-45-<suffix>` with a manager, a teacher and the student
 * under test. The spec logs in as `tenant.users.student` and reads every id
 * through `loadTenant`. Nothing shared is read or written: no admin setting,
 * feature flag, plan, platform stat or singleton row, and no other tenant.
 *
 * Walk (2026-11-28, `test/qa-STU-45` @ 896687d68, Polish UI, served production
 * build): `/app` lists Główne (Przegląd), Nauka (Ucz się, Wkuwaj, Sprawdź się,
 * Na żywo), Treści (Fiszki, Tematy, Pytania, Kartkówki, Zgłoszenia) and
 * Statystyki — there is no „Asystent Q” anchor and no `/app/ai` href anywhere in
 * the sidebar. A direct `page.goto('/app/ai')` keeps the URL (no redirect to
 * `/pricing`) and renders the plan card in place of the chat: „Asystent Q nie
 * jest dostępny w Twoim planie”, the plan description and „Zobacz plany”; the
 * composer, the chat controls and the usage badge are absent. The page header
 * breadcrumb still reads „Asystent Q”, so the absence check is scoped to the
 * sidebar's links, not to page text.
 *
 * Acceptance points:
 * 1. `GET /api/v1/me/entitlements` as the student resolves no `ai.chat` (the gate
 *    is the plan, not the persona), still resolves the free plan's baseline
 *    `flashcards`/`quiz`, and reports `max_ai_tokens_per_day: 0`.
 * 2. Step 1: the sidebar renders its menu and has no „Asystent Q” entry.
 * 3. Step 2: `/app/ai` shows the locked state (title, description, „Zobacz
 *    plany”) and no composer.
 * 4. `POST /api/v1/ai/chat` with the body the chat UI sends → 403 `FORBIDDEN`
 *    with an empty envelope (no stream, no answer); `GET /api/v1/ai/usage` → 403.
 *
 * No entitled-caller control here: the default tenant's manager holds no personal
 * plan (ADR-0007) and both the teacher and the student sit on the same personal
 * `free` plan, so an entitled caller needs a personal-plan write and a second
 * login. STU-47 (AI shard) pins the entitled `/app/ai` path; the control in this
 * spec is that the same payload still resolves the baseline keys and a 0-token
 * budget, so a resolver that answers with nothing cannot pass it.
 *
 * Mutation (proves this spec can fail), two axes on a rebuilt production build:
 * 1. `apps/web/src/components/ai/ai-chat-screen.tsx` →
 *    `const canChat = entitlement('ai.chat') || true;` (the client gate forced
 *    open). The locked-state assertion goes red with
 *    `Locator: getByText('Asystent Q nie jest dostępny w Twoim planie', { exact: true })`
 *    / `Error: element(s) not found`.
 * 2. `packages/server/src/lib/entitlements.ts` → `requireEntitlement()` starts
 *    with `return;` (the server gate dropped). The chat-call assertion goes red
 *    with `POST /api/v1/ai/chat → {"success":false,"error":"USAGE_LIMIT_EXCEEDED"}`,
 *    `Expected: 403`, `Received: 429`.
 * Both mutations were reverted and the restored build runs green.
 */

const CASE = 'STU-45';

const AI_CHAT = '/api/v1/ai/chat';
const AI_USAGE = '/api/v1/ai/usage';

/** Polish copy from `AiChatPage` / `DashboardLayout` (pl.json), as the UI renders it. */
const COPY = {
  sidebarEntry: 'Asystent Q',
  lockedTitle: 'Asystent Q nie jest dostępny w Twoim planie',
  lockedDesc:
    'Twój obecny plan nie obejmuje asystenta AI. Ulepsz plan, aby rozmawiać z Q, tworzyć fiszki i streszczenia.',
  lockedCta: 'Zobacz plany',
  composer: 'Zapytaj Q',
} as const;

interface EntitlementsEnvelope {
  success: boolean;
  data: {
    entitlements: string[];
    limits: Record<string, number>;
  };
}

/** The desktop sidebar — the only navigation this case is about. */
function sidebar(page: Page) {
  return page.locator('[data-slot="sidebar"]');
}

test.describe('@case:STU-45 @area:STU @prio:P2 free student has no AI chat', () => {
  test('hides „Asystent Q”, locks /app/ai and refuses the AI API', async ({ page }) => {
    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    const student = tenantUser(tenant, 'student');

    // Evidence for a failing run: the deterministic tenant this run owns.
    console.log(`STU-45 tenant key: ${tenant.key} (student ${student.email})`);

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await loginAs(page, tenant, 'student', { locale: 'pl', waitFor: /\/app(\/|$)/ });
    expect(new URL(page.url()).pathname, 'the student lands on /app').toBe('/app');
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

    // --- Premise: the plan, not the persona, is the reason -----------------
    // One API round trip, not a UI step: CI's 4-vCPU runner put this call near
    // the action budget in the STU-03 runs (43445896876, 43447812598).
    const entitlementsResponse = await page.request.get('/api/v1/me/entitlements', {
      timeout: 10_000,
    });
    expect(entitlementsResponse.status(), 'GET /api/v1/me/entitlements').toBe(200);
    const entitlements = await json<EntitlementsEnvelope>(entitlementsResponse);
    expect(entitlements.success, 'GET /api/v1/me/entitlements payload').toBe(true);
    expect(entitlements.data.entitlements, 'the Free plan resolves no ai.chat').not.toContain(
      'ai.chat',
    );
    expect(
      entitlements.data.entitlements,
      'the same payload still resolves the free plan’s baseline keys',
    ).toEqual(expect.arrayContaining(['flashcards', 'quiz']));
    expect(
      entitlements.data.limits.max_ai_tokens_per_day,
      'the Free plan grants no AI tokens, so no call can be metered',
    ).toBe(0);

    // --- Step 1: the sidebar has no „Asystent Q” --------------------------
    const nav = sidebar(page);
    await expect(nav, 'the student sidebar is rendered').toBeVisible();
    await expect(
      nav.locator('a[href="/app/flashcards"]'),
      'the sidebar renders the student menu',
    ).toBeVisible();
    await expect(
      nav.locator('a[href="/app/ai"]'),
      '„Asystent Q” is not rendered without ai.chat',
    ).toHaveCount(0);
    await expect(nav, 'no „Asystent Q” label in the menu').not.toContainText(COPY.sidebarEntry);

    // --- Step 2: a direct /app/ai stays on the locked page ----------------
    await page.goto('/app/ai');
    await expect(page).toHaveURL(/\/app\/ai$/);

    await expect(
      page.getByText(COPY.lockedTitle, { exact: true }),
      'the plan card replaces the chat',
    ).toBeVisible();
    await expect(page.getByText(COPY.lockedDesc, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: COPY.lockedCta, exact: true })).toBeVisible();

    // The composer never mounts, so a send cannot start.
    await expect(page.getByPlaceholder(COPY.composer), 'no composer').toHaveCount(0);
    await expect(
      page.getByLabel(/tokenów AI wykorzystanych dzisiaj/),
      'no usage counter without ai.chat',
    ).toHaveCount(0);

    // --- The API is the boundary: a chat call is refused -------------------
    const chatResponse = await page.request.post(AI_CHAT, {
      headers: { 'content-type': 'application/json' },
      // The body the chat UI sends: one user message. The gate refuses it
      // before the body is read, so the id only names this run's attempt.
      data: JSON.stringify({
        messages: [
          {
            id: `stu-45-${tenant.runSuffix ?? 'refused'}`,
            role: 'user',
            parts: [{ type: 'text', text: 'Wyjaśnij pojęcie fotosyntezy' }],
          },
        ],
      }),
    });
    const chatBody = await chatResponse.text();
    expect(chatResponse.status(), `POST ${AI_CHAT} → ${chatBody}`).toBe(403);
    expect(chatResponse.headers()['x-error-code'], `POST ${AI_CHAT} x-error-code`).toBe(
      'FORBIDDEN',
    );
    expect(JSON.parse(chatBody), `POST ${AI_CHAT} envelope`).toEqual({
      success: false,
      error: 'FORBIDDEN',
    });

    const usageResponse = await page.request.get(AI_USAGE);
    const usageBody = await usageResponse.text();
    expect(usageResponse.status(), `GET ${AI_USAGE} → ${usageBody}`).toBe(403);
    expect(usageResponse.headers()['x-error-code'], `GET ${AI_USAGE} x-error-code`).toBe(
      'FORBIDDEN',
    );

    expect(pageErrors, 'no browser console errors during the walk').toEqual([]);
  });
});
