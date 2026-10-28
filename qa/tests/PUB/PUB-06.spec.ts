import { expect, test, type Page } from '@playwright/test';

/**
 * PUB-06 — Polityka prywatności i Regulamin (strony publiczne, brak sesji).
 *
 * The case needs no session and no tenant data: both pages are static legal copy
 * that only depends on the `NEXT_LOCALE` cookie. The case's deterministic tenant
 * (`tenantKey('qa/cases/PUB-06.md', 'PUB-06', 'qa-shared')` →
 * `PUB-06.md::PUB-06::qa-shared`, seeded with `bun scripts/qa-tenant.ts PUB-06`)
 * is therefore bookkeeping only — the spec deliberately consumes no user or
 * content id, so it cannot depend on another worker's data.
 */

const PRIVACY_PL = [
  'Administrator Danych',
  'Jakie Dane Zbieramy',
  'Cel Przetwarzania',
  'Podstawa Prawna',
  'Twoje Prawa',
  'Przechowywanie Danych',
  'Pliki Cookies',
  'Kontakt',
] as const;

const PRIVACY_EN = [
  'Data Controller',
  'Data We Collect',
  'Purpose of Processing',
  'Legal Basis',
  'Your Rights',
  'Data Retention',
  'Cookies',
  'Contact',
] as const;

const TERMS_PL = [
  'Postanowienia Ogólne',
  'Konta Użytkowników',
  'Usługi',
  'Treści Użytkowników',
  'Płatności i Subskrypcje',
  'Ograniczenie Odpowiedzialności',
  'Pliki Cookies',
  'Zmiany Regulaminu',
  'Kontakt',
] as const;

const TERMS_EN = [
  'General Provisions',
  'User Accounts',
  'Services',
  'User Content',
  'Payments and Subscriptions',
  'Limitation of Liability',
  'Cookies',
  'Changes to Terms',
  'Contact',
] as const;

/** Any Cyrillic character would be a language error in a Polish/English page. */
const CYRILLIC = /[\u0400-\u04FF]/u;

/** Every expected section is present, in order, and carries body copy. */
async function expectAllSections(page: Page, headings: readonly string[]): Promise<void> {
  await expect(page.locator('main h2')).toHaveText([...headings]);

  const sections = page.locator('main section');
  await expect(sections).toHaveCount(headings.length);

  for (const [index, heading] of headings.entries()) {
    const text = (await sections.nth(index).innerText()).trim();
    expect(text.startsWith(heading), `section ${index + 1} starts with "${heading}"`).toBe(true);
    const body = text.slice(heading.length).trim();
    expect(body.length, `section "${heading}" has readable body copy`).toBeGreaterThan(20);
  }
}

async function expectNoCyrillic(page: Page, where: string): Promise<void> {
  const text = await page.locator('main').innerText();
  expect(text, `${where} contains only Polish/English copy`).not.toMatch(CYRILLIC);
}

/** Use the footer language toggle the same way a visitor does. */
async function switchLanguage(page: Page, label: 'Polski' | 'English'): Promise<void> {
  await page.locator('footer button[title="Language"]').click();
  await page.getByRole('menuitem', { name: new RegExp(label) }).click();
}

async function localeCookie(page: Page): Promise<string | undefined> {
  return (await page.context().cookies()).find((cookie) => cookie.name === 'NEXT_LOCALE')?.value;
}

test('serves every privacy-policy and terms section to a visitor without a session', async ({
  page,
}) => {
  await page.goto('/privacy');

  await expect(page.locator('h1')).toHaveText('Polityka Prywatności');
  await expect(page).toHaveTitle(/Polityka Prywatności/);
  await expectAllSections(page, PRIVACY_PL);
  await expectNoCyrillic(page, '/privacy (pl)');

  await page.goto('/terms');

  await expect(page.locator('h1')).toHaveText('Regulamin');
  await expect(page).toHaveTitle(/Regulamin/);
  await expectAllSections(page, TERMS_PL);
  await expectNoCyrillic(page, '/terms (pl)');

  // The v1.3 walk found the Cyrillic word "сохраняется" in
  // "Płatności i Subskrypcje"; the section must ship Polish copy only.
  const payments = page
    .locator('main section')
    .filter({ has: page.getByRole('heading', { name: 'Płatności i Subskrypcje', exact: true }) });
  await expect(payments).toHaveCount(1);
  await expect(payments).not.toContainText('сохраняется');
});

test('language toggle switches both legal pages to English and the choice survives a reload', async ({
  page,
}) => {
  await page.goto('/privacy');
  await expect(page.locator('h1')).toHaveText('Polityka Prywatności');

  await switchLanguage(page, 'English');

  await expect(page.locator('h1')).toHaveText('Privacy Policy');
  await expect(page).toHaveTitle(/Privacy Policy/);
  await expectAllSections(page, PRIVACY_EN);
  await expectNoCyrillic(page, '/privacy (en)');
  expect(await localeCookie(page)).toBe('en');

  // Step 2 of the case: refresh the pages and the English version must persist.
  await page.reload();
  await expect(page.locator('h1')).toHaveText('Privacy Policy');
  await expectAllSections(page, PRIVACY_EN);

  await page.goto('/terms');
  await expect(page.locator('h1')).toHaveText('Terms of Service');
  await expect(page).toHaveTitle(/Terms of Service/);
  await expectAllSections(page, TERMS_EN);
  await expectNoCyrillic(page, '/terms (en)');

  await page.reload();
  await expect(page.locator('h1')).toHaveText('Terms of Service');
  await expectAllSections(page, TERMS_EN);

  // The same toggle must lead back to Polish on a reloaded page.
  await switchLanguage(page, 'Polski');
  await expect(page.locator('h1')).toHaveText('Regulamin');
  await page.reload();
  await expect(page.locator('h1')).toHaveText('Regulamin');
  await expectAllSections(page, TERMS_PL);
});
