import { expect, test, type Page } from '@playwright/test';

/**
 * PUB-05 — Strona Kontakt (/contact).
 *
 * Prerequisite is "Brak sesji": /contact is a public marketing route whose
 * acceptance criteria belong to the anonymous visitor, so the spec signs nobody
 * in and starts from an empty storage state (`storageState: { cookies: [],
 * origins: [] }`). PUB-05's isolated tenant
 * (`tenantKey('qa/cases/PUB-05.md', 'PUB-05', 'qa-shared')` →
 * `PUB-05.md::PUB-05::qa-shared`, seeded with `bun scripts/qa-tenant.ts PUB-05`)
 * is bookkeeping only — the spec consumes no user, org or content id, so it can
 * never read or mutate another worker's tenant.
 *
 * The page is static copy plus `mailto:`/`tel:` links: no plan catalogue, flag or
 * singleton row is involved. The assertions below are the case's acceptance
 * criteria (five Polish sections incl. the registered office) and the two
 * adjacent regressions that matter for this surface: the public shell still
 * links to the page, and a page without a session still returns 200 with the
 * Polish document and no browser/HTTP errors.
 */

const CONTACT = {
  title: 'Kontakt',
  description: 'Skontaktuj się z odpowiednim zespołem',
} as const;

const TEAMS = [
  {
    name: 'Sprzedaż',
    description: 'Cennik, subskrypcje i partnerstwa',
    email: 'sales@studiq.pl',
    phone: '+48 123 567 890',
  },
  {
    name: 'Inspektor Ochrony Danych',
    description: 'Prywatność, prawa do danych i zapytania RODO',
    email: 'dpo@studiq.pl',
    phone: '+48 123 567 891',
  },
  {
    name: 'Kariera',
    description: 'Dołącz do naszego zespołu developerskiego',
    email: 'careers@studiq.pl',
    phone: '+48 123 567 892',
  },
  {
    name: 'Wsparcie',
    description: 'Pomoc techniczna i problemy z kontem',
    email: 'support@studiq.pl',
    phone: '+48 123 567 893',
  },
] as const;

const HEADQUARTERS = {
  name: 'Siedziba',
  description: 'Dane rejestrowe firmy',
  details: [
    'StudiQ sp. z o.o.',
    'ul. Przykładowa 1, 00-001 Warszawa',
    'Warszawa, Polska',
    'NIP: 000-000-00-00',
    'KRS: 0000000000',
  ],
} as const;

const HEADER_LINKS = [
  { name: 'Funkcje', href: '/features' },
  { name: 'Cennik', href: '/pricing' },
  { name: 'Logowanie', href: '/login' },
  { name: 'Rejestracja', href: '/register' },
] as const;

const FOOTER_LINKS = [
  { name: 'Kontakt', href: '/contact' },
  { name: 'Polityka Prywatności', href: '/privacy' },
  { name: 'Regulamin', href: '/terms' },
] as const;

/** Collect browser-side failures so "no errors" is asserted, not assumed. */
function watchForErrors(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedResponses: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
  });

  return {
    expectClean() {
      expect(pageErrors, 'uncaught page errors').toEqual([]);
      expect(consoleErrors, 'console errors').toEqual([]);
      expect(failedResponses, 'HTTP responses >= 400').toEqual([]);
    },
  };
}

/** The card that owns a given `CardTitle` — the page has no test ids. */
function cardByTitle(page: Page, title: string) {
  return page
    .locator('main [data-slot="card"]')
    .filter({ has: page.locator('[data-slot="card-title"]', { hasText: title }) });
}

/** Every acceptance criterion of PUB-05, in page order, in Polish. */
async function expectContactPage(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/contact$/);
  // Issue #290: the page must not fall back to the generic "StudiQ" title.
  await expect(page).toHaveTitle(/^Kontakt\b/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

  await expect(
    page.getByRole('heading', { level: 1, name: CONTACT.title, exact: true }),
  ).toBeVisible();
  await expect(page.getByText(CONTACT.description, { exact: true })).toBeVisible();

  // Four teams plus the registered office, and nothing else.
  await expect(page.locator('main [data-slot="card"]')).toHaveCount(TEAMS.length + 1);

  for (const team of TEAMS) {
    const card = cardByTitle(page, team.name);
    await expect(card, `card for ${team.name}`).toHaveCount(1);
    await expect(card.locator('[data-slot="card-title"]')).toHaveText(team.name);
    await expect(card.getByText(team.description, { exact: true })).toBeVisible();

    const mail = card.locator(`a[href="mailto:${team.email}"]`);
    await expect(mail, `mail link for ${team.name}`).toHaveText(team.email);

    const phone = card.locator(`a[href="tel:${team.phone.replaceAll(' ', '')}"]`);
    await expect(phone, `phone link for ${team.name}`).toHaveText(team.phone);
  }

  const headquarters = cardByTitle(page, HEADQUARTERS.name);
  await expect(headquarters).toHaveCount(1);
  await expect(headquarters.locator('[data-slot="card-title"]')).toHaveText(HEADQUARTERS.name);
  await expect(headquarters.getByText(HEADQUARTERS.description, { exact: true })).toBeVisible();
  for (const detail of HEADQUARTERS.details) {
    await expect(headquarters.getByText(detail, { exact: true })).toBeVisible();
  }

  // Public shell around the page (the route is reachable and escapable).
  const header = page.locator('header');
  for (const { name, href } of HEADER_LINKS) {
    await expect(header.getByRole('link', { name, exact: true })).toHaveAttribute('href', href);
  }
  const footer = page.locator('footer');
  for (const column of ['Produkt', 'Firma', 'Prawne']) {
    await expect(footer.getByRole('heading', { name: column, exact: true })).toBeVisible();
  }
  for (const { name, href } of FOOTER_LINKS) {
    await expect(footer.getByRole('link', { name, exact: true })).toHaveAttribute('href', href);
  }

  // No raw translation keys or unrendered placeholders anywhere on the page.
  const body = await page.locator('body').innerText();
  expect(body, 'raw translation keys').not.toMatch(
    /\b(?:ContactPage|Footer|Navbar|LandingPage)\.[A-Za-z_]+/,
  );
  expect(body, 'literal undefined').not.toMatch(/\bundefined\b/);
  expect(body, 'literal NaN').not.toMatch(/\bNaN\b/);
}

test.describe('@case:PUB-05 @area:PUB @prio:P3 contact page', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ context, baseURL }) => {
    // Pin the app's default language so the Polish copy cannot be switched by a
    // stale cookie from another run.
    const { hostname } = new URL(baseURL!);
    await context.addCookies([{ name: 'NEXT_LOCALE', value: 'pl', domain: hostname, path: '/' }]);
  });

  test('renders every Polish contact section, company detail and public nav link', async ({
    page,
  }) => {
    const errors = watchForErrors(page);

    const response = await page.goto('/contact');
    expect(response?.status(), 'document status').toBe(200);

    // Prerequisite "Brak sesji".
    const me = await page.request.get('/api/v1/auth/me');
    expect(me.status()).toBe(200);
    const meBody = (await me.json()) as { data?: { user?: unknown } };
    expect(meBody.data?.user ?? null).toBeNull();

    await expectContactPage(page);
    errors.expectClean();
  });

  test('is reachable from the public footer and stays readable by deep link', async ({ page }) => {
    const errors = watchForErrors(page);

    // A visitor lands on the home page and uses the public footer.
    const landing = await page.goto('/');
    expect(landing?.status(), 'landing status').toBe(200);
    await page.locator('footer').getByRole('link', { name: 'Kontakt', exact: true }).click();
    await expectContactPage(page);

    // Leave through the header, come back through the footer: both directions
    // of the public navigation must keep working.
    await page.locator('header').getByRole('link', { name: 'Cennik', exact: true }).click();
    await expect(page).toHaveURL(/\/pricing$/);
    await page.locator('footer').getByRole('link', { name: 'Kontakt', exact: true }).click();
    await expectContactPage(page);

    // Adjacent regression: the route is a first-class deep link, not only a
    // client-side target of the landing page.
    const direct = await page.goto('/contact');
    expect(direct?.status(), 'deep-link status').toBe(200);
    await expectContactPage(page);

    errors.expectClean();
  });
});
