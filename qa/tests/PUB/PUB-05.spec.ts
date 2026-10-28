import { expect, test, type Page } from '@playwright/test';
import { qaTenant, signInAs } from '#test/helpers/qa-tenant';

/**
 * PUB-05 — Strona Kontakt (/contact).
 *
 * Prerequisite: no session. The page is a public, data-free marketing route, so
 * the fixture tenant is only used by the signed-in adjacency test; the case's
 * own assertions are stateless and never touch shared seed data.
 */

const CONTACT_HEADING = 'Kontakt';
const CONTACT_DESCRIPTION = 'Skontaktuj się z odpowiednim zespołem';

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

const COMPANY_DETAILS = [
  'StudiQ sp. z o.o.',
  'ul. Przykładowa 1, 00-001 Warszawa',
  'Warszawa, Polska',
  'NIP: 000-000-00-00',
  'KRS: 0000000000',
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

function teamCard(page: Page, name: string) {
  return page.locator('[data-slot="card"]').filter({ hasText: name });
}

async function expectContactContent(page: Page) {
  await expect(
    page.getByRole('heading', { level: 1, name: CONTACT_HEADING, exact: true }),
  ).toBeVisible();
  await expect(page.getByText(CONTACT_DESCRIPTION, { exact: true })).toBeVisible();

  // Five cards: the four teams plus the registered office.
  await expect(page.locator('[data-slot="card"]')).toHaveCount(5);

  for (const team of TEAMS) {
    const card = teamCard(page, team.name);
    await expect(card, `card for ${team.name}`).toHaveCount(1);
    await expect(card.getByText(team.name, { exact: true })).toBeVisible();
    await expect(card.getByText(team.description, { exact: true })).toBeVisible();

    const mail = card.locator(`a[href="mailto:${team.email}"]`);
    await expect(mail).toHaveText(team.email);

    const phone = card.locator(`a[href="tel:${team.phone.replaceAll(' ', '')}"]`);
    await expect(phone).toHaveText(team.phone);
  }

  const headquarters = teamCard(page, 'Siedziba');
  await expect(headquarters).toHaveCount(1);
  await expect(headquarters.getByText('Siedziba', { exact: true })).toBeVisible();
  await expect(headquarters.getByText('Dane rejestrowe firmy', { exact: true })).toBeVisible();
  for (const detail of COMPANY_DETAILS) {
    await expect(headquarters.getByText(detail, { exact: true })).toBeVisible();
  }
}

test.describe('@case:PUB-05 @area:PUB @prio:P3 contact page', () => {
  test.describe('anonymous visitor', () => {
    // The case's prerequisite is "Brak sesji" — make that explicit.
    test.use({ storageState: { cookies: [], origins: [] } });

    test('renders every Polish contact section, company detail and public nav link', async ({
      page,
    }) => {
      const errors = watchForErrors(page);

      const response = await page.goto('/contact');
      expect(response?.status()).toBe(200);
      await expect(page).toHaveURL(/\/contact$/);

      await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
      await expectContactContent(page);

      // The shared public shell: header nav and footer, all in Polish.
      const header = page.locator('header');
      await expect(header.getByRole('link', { name: 'Funkcje', exact: true })).toHaveAttribute(
        'href',
        '/features',
      );
      await expect(header.getByRole('link', { name: 'Cennik', exact: true })).toHaveAttribute(
        'href',
        '/pricing',
      );
      await expect(header.getByRole('link', { name: 'Logowanie', exact: true })).toHaveAttribute(
        'href',
        '/login',
      );
      await expect(header.getByRole('link', { name: 'Rejestracja', exact: true })).toHaveAttribute(
        'href',
        '/register',
      );

      const footer = page.locator('footer');
      await expect(footer.getByText('Produkt', { exact: true })).toBeVisible();
      await expect(footer.getByText('Firma', { exact: true })).toBeVisible();
      await expect(footer.getByText('Prawne', { exact: true })).toBeVisible();
      await expect(footer.getByRole('link', { name: 'Kontakt', exact: true })).toHaveAttribute(
        'href',
        '/contact',
      );
      await expect(
        footer.getByRole('link', { name: 'Polityka Prywatności', exact: true }),
      ).toHaveAttribute('href', '/privacy');
      await expect(footer.getByRole('link', { name: 'Regulamin', exact: true })).toHaveAttribute(
        'href',
        '/terms',
      );

      // No raw translation keys or unrendered values anywhere on the page.
      const body = await page.locator('body').innerText();
      expect(body).not.toMatch(/\b(?:ContactPage|Footer|Navbar)\.[a-z_]+/);
      expect(body).not.toMatch(/\b(?:undefined|NaN)\b/);

      errors.expectClean();
    });

    test('is reachable from the public navigation (Cennik → Kontakt in the footer)', async ({
      page,
    }) => {
      await page.goto('/contact');

      await page.locator('header').getByRole('link', { name: 'Cennik', exact: true }).click();
      await expect(page).toHaveURL(/\/pricing$/);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

      await page.locator('footer').getByRole('link', { name: 'Kontakt', exact: true }).click();
      await expect(page).toHaveURL(/\/contact$/);
      await expect(
        page.getByRole('heading', { level: 1, name: CONTACT_HEADING, exact: true }),
      ).toBeVisible();
    });
  });

  test('stays readable for a signed-in tenant user', async ({ page }, testInfo) => {
    const tenant = qaTenant('PUB-05');
    const baseURL = testInfo.project.use.baseURL ?? 'http://localhost:3010';

    const errors = watchForErrors(page);
    await signInAs(page, tenant, 'student', baseURL);

    const response = await page.goto('/contact');
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/contact$/);

    // A public route must not be gated by the signed-in shell.
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
    await expectContactContent(page);

    errors.expectClean();
  });
});
