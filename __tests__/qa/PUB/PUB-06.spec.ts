import en from '@/i18n/messages/en.json';
import pl from '@/i18n/messages/pl.json';
import { expect, test, type Page } from '@playwright/test';
import { createTranslator } from 'next-intl';

/**
 * PUB-06 — Polityka prywatności i Regulamin (strony publiczne, brak sesji).
 *
 * The case needs no session and no tenant data: both pages are legal copy whose
 * only input is the `NEXT_LOCALE` cookie. Its deterministic tenant
 * (`tenantKey('qa/cases/PUB-06.md', 'PUB-06', 'qa-shared')` →
 * `PUB-06.md::PUB-06::qa-shared`, seeded with `bun scripts/qa-tenant.ts PUB-06`)
 * is bookkeeping only — the spec consumes no user, org or content id, so it can
 * never read or mutate another worker's tenant.
 *
 * Each test runs in a fresh browser context (empty cookie jar), so the pages
 * render their `pl` default without the suite having to clear another visitor's
 * language choice.
 *
 * The identity assertions — the footer's link label and each page's title and
 * `h1` — read their copy from the same catalogues the pages render from, so the
 * spec pins *which* document the visitor reached, not the wording of it. The
 * section inventories below stay literal on purpose: they are the case's list of
 * sections that must exist, and a key rename must not silently shrink it.
 */
const copy = {
  pl: {
    footer: createTranslator({ locale: 'pl', messages: pl, namespace: 'Footer' }),
    privacy: createTranslator({ locale: 'pl', messages: pl, namespace: 'PrivacyPage' }),
    terms: createTranslator({ locale: 'pl', messages: pl, namespace: 'TermsPage' }),
  },
  en: {
    privacy: createTranslator({ locale: 'en', messages: en, namespace: 'PrivacyPage' }),
    terms: createTranslator({ locale: 'en', messages: en, namespace: 'TermsPage' }),
  },
} as const;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The root layout appends the site name to every document title (`'%s | StudiQ'`
 * in `apps/web/src/app/layout.tsx`), so a page's own title is asserted *within*
 * the rendered title — the same thing the case means by "the page is titled X".
 */
function titleContaining(title: string): RegExp {
  return new RegExp(escapeRegExp(title));
}

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

/**
 * The v1.3 walk found the Cyrillic word "сохраняется" in „Płatności i
 * Subskrypcje". Neither language may ship foreign-alphabet copy.
 */
const CYRILLIC = /[\u0400-\u04FF]/u;

/** Every expected section is present, in order, and carries readable body copy. */
async function expectSections(page: Page, headings: readonly string[]): Promise<void> {
  await expect(page.locator('main h2')).toHaveText([...headings]);

  const sections = page.locator('main section');
  await expect(sections).toHaveCount(headings.length);

  for (const [index, heading] of headings.entries()) {
    const text = (await sections.nth(index).innerText()).trim();
    const body = text.startsWith(heading) ? text.slice(heading.length).trim() : '';
    expect(body.length, `section "${heading}" carries body copy`).toBeGreaterThan(40);
  }
}

async function expectNoCyrillic(page: Page, where: string): Promise<void> {
  const text = await page.locator('main').innerText();
  expect(text, `${where} contains only Polish/English copy`).not.toMatch(CYRILLIC);
}

/** Use the footer language select the same way a visitor does. */
async function switchLanguage(page: Page, label: 'Polski' | 'English'): Promise<void> {
  await page
    .locator('footer')
    .getByRole('combobox', { name: /^(Język|Language):/ })
    .click();
  await page.getByRole('option', { name: new RegExp(label) }).click();
}

async function localeCookie(page: Page): Promise<string | undefined> {
  const cookies = await page.context().cookies();
  return cookies.find((cookie) => cookie.name === 'NEXT_LOCALE')?.value;
}

test('serves every privacy-policy and terms section to a visitor without a session', async ({
  page,
}) => {
  // A visitor reaches the legal pages from the public footer.
  await page.goto('/');
  await expect(page.locator('footer a[href="/privacy"]')).toHaveText(copy.pl.footer('privacy'));
  await expect(page.locator('footer a[href="/terms"]')).toHaveText(copy.pl.footer('terms'));

  await page.locator('footer a[href="/privacy"]').click();
  await expect(page).toHaveURL(/\/privacy$/);

  await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
  await expect(page).toHaveTitle(titleContaining(copy.pl.privacy('title')));
  await expect(page.locator('main h1')).toHaveText(copy.pl.privacy('title'));
  await expectSections(page, PRIVACY_PL);
  await expectNoCyrillic(page, '/privacy (pl)');

  await page.locator('footer a[href="/terms"]').click();
  await expect(page).toHaveURL(/\/terms$/);

  await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
  await expect(page).toHaveTitle(titleContaining(copy.pl.terms('title')));
  await expect(page.locator('main h1')).toHaveText(copy.pl.terms('title'));
  await expectSections(page, TERMS_PL);
  await expectNoCyrillic(page, '/terms (pl)');

  const payments = page
    .locator('main section')
    .filter({ has: page.getByRole('heading', { name: 'Płatności i Subskrypcje', exact: true }) });
  await expect(payments).toHaveCount(1);
  await expect(payments).not.toContainText('сохраняется');
});

test('language toggle serves the English legal pages after a refresh, then Polish again', async ({
  page,
}) => {
  await page.goto('/privacy');
  await expect(page.locator('main h1')).toHaveText(copy.pl.privacy('title'));
  await expectSections(page, PRIVACY_PL);

  await switchLanguage(page, 'English');

  await expect(page.locator('main h1')).toHaveText(copy.en.privacy('title'));
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page).toHaveTitle(titleContaining(copy.en.privacy('title')));
  await expectSections(page, PRIVACY_EN);
  await expectNoCyrillic(page, '/privacy (en)');
  expect(await localeCookie(page), 'the visitor language choice is stored').toBe('en');

  // Step 2 of the case: refresh the page and the English version stays.
  await page.reload();
  await expect(page.locator('main h1')).toHaveText(copy.en.privacy('title'));
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expectSections(page, PRIVACY_EN);

  await page.goto('/terms');
  await expect(page.locator('main h1')).toHaveText(copy.en.terms('title'));
  await expect(page).toHaveTitle(titleContaining(copy.en.terms('title')));
  await expectSections(page, TERMS_EN);
  await expectNoCyrillic(page, '/terms (en)');

  await page.reload();
  await expect(page.locator('main h1')).toHaveText(copy.en.terms('title'));
  await expectSections(page, TERMS_EN);

  // The same toggle must lead back to Polish, and the choice must survive a refresh.
  await switchLanguage(page, 'Polski');
  await expect(page.locator('main h1')).toHaveText(copy.pl.terms('title'));
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
  expect(await localeCookie(page)).toBe('pl');

  await page.reload();
  await expect(page.locator('main h1')).toHaveText(copy.pl.terms('title'));
  await expectSections(page, TERMS_PL);
  await expectNoCyrillic(page, '/terms (pl)');
});
