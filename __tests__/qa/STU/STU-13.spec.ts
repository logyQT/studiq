import { expect, test } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * STU-13 — the "Na żywo" page is a coming-soon screen, not a broken feature.
 *
 * Legacy prerequisite (`student1@dev.local`) is replaced by the case's own tenant:
 *
 *   bun scripts/qa-tenant.ts STU-13 --fresh
 *
 * `__tests__/qa/profiles/STU-13.json` declares the `content` profile; only its
 * `users.student` matters here — the page renders no tenant data, so the spec
 * seeds nothing else and reads no shared content.
 *
 * The case says "wpisz dowolny kod". The shipped control is a six-slot code
 * (`SESSION_CODE_LENGTH = 6`) and the join button stays disabled until all six
 * slots are filled, so "any code" means any six characters. That guard is part
 * of the page (it is what stops an empty join), so the test asserts it as
 * intended behavior and then asserts the documented outcome of a complete code:
 * the "Sesje na żywo już wkrótce!" message, no navigation and no crash.
 *
 * The FAQ route is asserted separately (step 3), plus the two route-protection
 * paths that guard this student-only surface: anonymous → `/login?next=…` and
 * educator → `/edu`.
 */

const CASE = 'STU-13';
const SESSION_CODE = 'ABC123';
const PARTIAL_CODE = 'ABC';

/** Polish copy from `AppLiveStudyPage` (`pl.json`) and the case text. */
const COPY = {
  title: 'Nauka na żywo',
  subtitle:
    'Dołącz do sesji na żywo ze swoim nauczycielem. Odpowiadaj na pytania w czasie rzeczywistym i rywalizuj z klasą.',
  comingSoon: 'Sesje na żywo już wkrótce!',
  codeLabel: 'Kod sesji',
  codeHint: 'Wpisz kod sesji',
  join: 'Dołącz do sesji',
  faqLink: 'Jak to działa?',
  faqTitle: 'Jak dołączyć do sesji na żywo',
  faqSubtitle: 'Wykonaj trzy proste kroki, aby uczestniczyć w sesji nauki na żywo ze swoją klasą.',
  steps: [
    {
      number: '01',
      title: 'Nauczyciel udostępnia kod',
      desc: 'Nauczyciel uruchamia sesję na żywo i udostępnia unikalny kod klasie.',
    },
    {
      number: '02',
      title: 'Wprowadzasz kod',
      desc: 'Wpisz kod tutaj, aby natychmiast dołączyć do sesji.',
    },
    {
      number: '03',
      title: 'Odpowiadasz na żywo',
      desc: 'Odpowiadaj na pytania na bieżąco i widź wyniki natychmiast.',
    },
  ],
} as const;

function studentTenant(): QaTenant {
  const tenant = loadTenant(CASE);
  expect(tenant.profile, 'STU-13 needs the content tenant profile').toBe('content');
  if (!tenant.users.student) {
    throw new Error('STU-13 fixture incomplete: run `bun scripts/qa-tenant.ts STU-13 --fresh`');
  }
  return tenant;
}

test.describe('STU-13 @area:STU @prio:P3 live study page', () => {
  test('each step card renders its number, title and description', async ({ page }) => {
    await loginAs(page, studentTenant(), 'student', { locale: 'pl', waitFor: /\/app/ });

    // Case step 1: the page is reachable at its own URL and renders for a student.
    const response = await page.goto('/app/study/live');
    expect(response?.status(), 'GET /app/study/live').toBe(200);
    await expect(page).toHaveURL(/\/app\/study\/live$/);
    await expect(page.getByRole('heading', { level: 1, name: COPY.title })).toBeVisible();
    await expect(page.getByText(COPY.subtitle)).toBeVisible();

    // Expected result 1: the "coming soon" alert and the three described steps.
    await expect(page.getByText(COPY.comingSoon)).toBeVisible();
    for (const step of COPY.steps) {
      const card = page
        .locator('[data-slot="card"]')
        .filter({ has: page.getByRole('heading', { level: 2, name: step.title }) });
      await expect(card, `step ${step.number} card`).toHaveCount(1);
      await expect(card.getByText(step.number, { exact: true })).toBeVisible();
      await expect(card.getByText(step.desc, { exact: true })).toBeVisible();
    }

    // The code input and its hint are labelled, and the join action is on the page.
    await expect(page.getByLabel(COPY.codeLabel, { exact: true })).toBeVisible();
    await expect(page.getByText(COPY.codeHint, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: COPY.join, exact: true })).toBeVisible();
  });

  test('a six-slot code triggers the coming-soon message without leaving the page', async ({
    page,
  }) => {
    await loginAs(page, studentTenant(), 'student', { locale: 'pl', waitFor: /\/app/ });
    await page.goto('/app/study/live');

    const code = page.getByLabel(COPY.codeLabel, { exact: true });
    const join = page.getByRole('button', { name: COPY.join, exact: true });
    const emptyCode = await code.inputValue();
    expect(emptyCode, 'the code field starts empty').toBe('');

    // The join button is guarded while the code is incomplete.
    await expect(join).toBeDisabled();
    await code.pressSequentially(PARTIAL_CODE);
    await expect(code).toHaveValue(PARTIAL_CODE);
    await expect(join).toBeDisabled();

    // Case step 2: a complete code enables the action.
    await code.pressSequentially(SESSION_CODE.slice(PARTIAL_CODE.length));
    await expect(code).toHaveValue(SESSION_CODE);
    await expect(join).toBeEnabled();

    await join.click();

    // Expected result 2: no real feature yet — the coming-soon toast, no crash,
    // no navigation, and the page is still usable afterwards.
    const toast = page.locator('[data-sonner-toast]').filter({ hasText: COPY.comingSoon });
    await expect(toast).toBeVisible();
    await expect(page.getByText(COPY.comingSoon).first()).toBeVisible();
    await expect(page).toHaveURL(/\/app\/study\/live$/);
    await expect(page.getByRole('heading', { level: 1, name: COPY.title })).toBeVisible();
    await expect(join).toBeEnabled();
  });

  test('the FAQ link opens the "how to join" page and returns', async ({ page }) => {
    await loginAs(page, studentTenant(), 'student', { locale: 'pl', waitFor: /\/app/ });
    await page.goto('/app/study/live');

    await page.getByRole('link', { name: COPY.faqLink, exact: true }).click();

    // Case step 3 / expected result 3: the FAQ page loads correctly.
    await expect(page).toHaveURL(/\/app\/study\/live\/faq$/);
    await expect(page.getByRole('heading', { level: 1, name: COPY.faqTitle })).toBeVisible();
    await expect(page.getByText(COPY.faqSubtitle)).toBeVisible();
    for (const step of COPY.steps) {
      await expect(
        page.getByRole('heading', { level: 2, name: step.title, exact: true }),
      ).toBeVisible();
      await expect(page.getByText(step.desc, { exact: true })).toBeVisible();
    }

    // The page is also reachable by its own URL (a bookmark / deep link).
    const direct = await page.goto('/app/study/live/faq');
    expect(direct?.status(), 'GET /app/study/live/faq').toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: COPY.faqTitle })).toBeVisible();

    // The back link returns to the live page.
    await page.getByRole('link', { name: COPY.title, exact: true }).first().click();
    await expect(page).toHaveURL(/\/app\/study\/live$/);
  });

  test('anonymous visitors are sent to the login page for both routes', async ({ page }) => {
    const live = await page.goto('/app/study/live');
    expect(live?.status(), 'anonymous GET /app/study/live').toBe(200);
    await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Fstudy%2Flive$/);

    const faq = await page.goto('/app/study/live/faq');
    expect(faq?.status(), 'anonymous GET /app/study/live/faq').toBe(200);
    await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Fstudy%2Flive%2Ffaq$/);
  });

  test('an educator is redirected to the teacher dashboard', async ({ page }) => {
    const tenant = studentTenant();
    await loginAs(page, tenant, 'teacher', { locale: 'pl', waitFor: /\/edu/ });

    await page.goto('/app/study/live');
    await expect(page).toHaveURL(/\/edu$/);
  });
});
