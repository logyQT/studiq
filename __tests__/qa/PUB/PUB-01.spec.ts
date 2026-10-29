import { expect, test, type Page } from '@playwright/test';

/**
 * PUB-01 — Strona główna (/): wygląd i treść dla gościa bez sesji.
 *
 * Prerequisite: no session, Polish locale. The landing page is public and its
 * acceptance criteria are the anonymous visitor's, so the case's isolated tenant
 * (`qa/cases/PUB-01.md::PUB-01::qa-shared`, seeded with
 * `bun scripts/qa-tenant.ts PUB-01`) is never signed in: no storage state, no
 * cookie, no fixture user. The spec therefore touches no tenant, plan or
 * singleton row. The pricing teaser is DB-driven global product config, so it is
 * asserted by heading and link only — never by plan names or prices.
 */

const HERO = {
  badge: 'Platforma edukacyjna oparta na AI',
  title: 'Tylko to, co musisz umieć.',
  subtitle: 'Testy, fiszki i przygotowanie do egzaminów oparte na AI - dla studentów i uczelni',
  primaryCta: 'Zacznij Naukę Za Darmo',
  secondaryCta: 'Zobacz Funkcje',
} as const;

const STATS = [
  { label: 'Utworzonych pytań' },
  { label: 'Fiszek' },
  { label: 'Aktywnych uczniów' },
  { label: 'Rozwiązanych testów' },
] as const;

const FREE = {
  badge: 'Zawsze za darmo',
  title: 'Co Otrzymujesz Za Darmo',
  description: 'Bez karty kredytowej. Zacznij naukę jeszcze dziś.',
  items: ['Twórz Własne Pytania', 'Ćwicz z Fiszkami', 'Rozwiązuj Testy', 'Podstawowe Statystyki'],
} as const;

const AI = {
  badge: 'Premium i Uczelnie',
  title: 'Wspomagaj Naukę z AI',
  description: 'Odblokuj funkcje oparte na AI z planem Premium lub Uniwersyteckim',
  items: ['Generowanie Pytań przez AI', 'Inteligentne Generowanie Fiszek', 'Symulacja Egzaminu AI'],
} as const;

const HOW = {
  title: 'Jak to działa',
  description: 'Trzy proste kroki do efektywnej nauki',
  steps: ['Twórz Treści', 'Ćwicz Regularnie', 'Śledź Postępy'],
} as const;

const TESTIMONIALS = {
  title: 'Pokochane przez studentów i nauczycieli',
  items: [
    {
      quote:
        'Fiszki generowane przez AI ze StudiQ zaoszczędziły mi godzin ręcznej pracy. Moje wyniki egzaminów znacznie się poprawiły.',
      author: 'Maria K.',
      role: 'Studentka Medycyny',
    },
    {
      quote:
        'Jako nauczyciel mogę łatwo tworzyć banki pytań i śledzić postępy całej klasy. To przełom.',
      author: 'Dr. Tomasz N.',
      role: 'Profesor Uniwersytecki',
    },
  ],
} as const;

const PRICING = {
  title: 'Prosty, Przejrzysty Cennik',
  description: 'Wybierz plan, który Ci odpowiada',
  fullPricingCta: 'Zobacz Pełny Cennik',
} as const;

const BANNER = {
  title: 'Gotowy na transformację nauki?',
  description: 'Dołącz do tysięcy studentów i nauczycieli już korzystających ze StudiQ',
  cta: 'Zacznij za Darmo',
} as const;

const FOOTER = {
  tagline: 'Twoja platforma do efektywnej nauki',
  columns: ['Produkt', 'Firma', 'Prawne'],
  links: [
    { name: 'Funkcje', href: '/features' },
    { name: 'Cennik', href: '/pricing' },
    { name: 'Kontakt', href: '/contact' },
    { name: 'Polityka Prywatności', href: '/privacy' },
    { name: 'Regulamin', href: '/terms' },
  ],
  copyright: /^© \d{4} StudiQ\. Wszelkie prawa zastrzeżone\.$/,
} as const;

/**
 * Collect browser-side failures so "the page loads without errors" is asserted,
 * not assumed. Only document responses are checked: the shared app is a dev
 * server, and asset/HMR noise is not part of this case.
 */
function watchForErrors(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedDocuments: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('response', (response) => {
    if (response.request().resourceType() === 'document' && response.status() >= 400) {
      failedDocuments.push(`${response.status()} ${response.url()}`);
    }
  });

  return {
    expectClean() {
      expect(pageErrors, 'uncaught page errors').toEqual([]);
      expect(consoleErrors, 'console errors').toEqual([]);
      expect(failedDocuments, 'failed document responses').toEqual([]);
    },
  };
}

/** The `<section>` that owns a given heading — the landing page has no test ids. */
function sectionWithHeading(page: Page, name: string) {
  return page.locator('section').filter({ has: page.getByRole('heading', { name, exact: true }) });
}

test.describe('PUB-01 — landing page for an anonymous visitor', () => {
  test('renders every Polish section without browser errors', async ({ page }) => {
    const errors = watchForErrors(page);

    const response = await page.goto('/');
    expect(response?.status(), 'document status').toBe(200);

    // No session, default locale: the page must be Polish.
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');

    // --- Hero -------------------------------------------------------------
    const hero = sectionWithHeading(page, HERO.title);
    await expect(page.getByText(HERO.badge, { exact: true })).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 1, name: HERO.title, exact: true }),
    ).toBeVisible();
    await expect(page.getByText(HERO.subtitle, { exact: true })).toBeVisible();
    await expect(hero.getByRole('link', { name: HERO.primaryCta, exact: true })).toBeVisible();
    await expect(hero.getByRole('link', { name: HERO.secondaryCta, exact: true })).toBeVisible();

    // --- Header -----------------------------------------------------------
    const header = page.locator('header');
    await expect(header.getByRole('link', { name: 'StudiQ', exact: true })).toBeVisible();
    for (const name of ['Funkcje', 'Cennik', 'Logowanie', 'Rejestracja']) {
      await expect(header.getByRole('link', { name, exact: true })).toBeVisible();
    }

    // --- Stats ------------------------------------------------------------
    for (const { label } of STATS) {
      const labelText = page.getByText(label, { exact: true });
      await expect(labelText).toBeVisible();
      // Each stat is a value/label pair; the value must be a real number, never blank.
      await expect(labelText.locator('..')).toHaveText(/\d[\d,.]*\+?/);
    }

    // --- Free tier + AI block --------------------------------------------
    const freeSection = sectionWithHeading(page, FREE.title);
    await expect(page.getByText(FREE.badge, { exact: true })).toBeVisible();
    await expect(freeSection.getByRole('heading', { level: 2, name: FREE.title })).toBeVisible();
    await expect(page.getByText(FREE.description, { exact: true })).toBeVisible();
    for (const item of FREE.items) {
      await expect(freeSection.getByText(item, { exact: true })).toBeVisible();
    }

    await expect(page.getByText(AI.badge, { exact: true })).toBeVisible();
    await expect(freeSection.getByRole('heading', { level: 2, name: AI.title })).toBeVisible();
    await expect(page.getByText(AI.description, { exact: true })).toBeVisible();
    for (const item of AI.items) {
      await expect(freeSection.getByText(item, { exact: true })).toBeVisible();
    }

    // --- How it works -----------------------------------------------------
    const howSection = sectionWithHeading(page, HOW.title);
    await expect(howSection.getByRole('heading', { level: 2, name: HOW.title })).toBeVisible();
    await expect(page.getByText(HOW.description, { exact: true })).toBeVisible();
    for (const [index, step] of HOW.steps.entries()) {
      await expect(howSection.getByText(`Krok ${index + 1}`, { exact: true })).toBeVisible();
      await expect(howSection.getByText(step, { exact: true })).toBeVisible();
    }

    // --- Testimonials -----------------------------------------------------
    const testimonialsSection = sectionWithHeading(page, TESTIMONIALS.title);
    await expect(
      testimonialsSection.getByRole('heading', { level: 2, name: TESTIMONIALS.title }),
    ).toBeVisible();
    for (const { quote, author, role } of TESTIMONIALS.items) {
      await expect(testimonialsSection.getByText(quote, { exact: false })).toBeVisible();
      await expect(testimonialsSection.getByText(author, { exact: true })).toBeVisible();
      await expect(testimonialsSection.getByText(role, { exact: true })).toBeVisible();
    }

    // --- Pricing teaser (DB-driven: heading and link only) ----------------
    const pricingSection = sectionWithHeading(page, PRICING.title);
    await expect(
      pricingSection.getByRole('heading', { level: 2, name: PRICING.title }),
    ).toBeVisible();
    await expect(page.getByText(PRICING.description, { exact: true })).toBeVisible();
    await expect(
      pricingSection.getByRole('link', { name: PRICING.fullPricingCta, exact: true }),
    ).toBeVisible();

    // --- CTA banner -------------------------------------------------------
    const bannerSection = sectionWithHeading(page, BANNER.title);
    await expect(
      bannerSection.getByRole('heading', { level: 2, name: BANNER.title }),
    ).toBeVisible();
    await expect(page.getByText(BANNER.description, { exact: true })).toBeVisible();
    await expect(bannerSection.getByRole('link', { name: BANNER.cta, exact: true })).toBeVisible();

    // --- Footer (case step 2: scroll top → footer) ------------------------
    const footer = page.locator('footer');
    await footer.scrollIntoViewIfNeeded();
    await expect(footer).toBeInViewport();
    await expect(footer.getByText(FOOTER.tagline, { exact: true })).toBeVisible();
    for (const column of FOOTER.columns) {
      await expect(footer.getByRole('heading', { name: column, exact: true })).toBeVisible();
    }
    for (const { name } of FOOTER.links) {
      await expect(footer.getByRole('link', { name, exact: true })).toBeVisible();
    }
    await expect(footer.getByText(FOOTER.copyright)).toBeVisible();

    // --- No raw translation keys, no "undefined"/"NaN" placeholders -------
    const body = await page.locator('body').innerText();
    expect(body, 'raw translation keys').not.toMatch(/\b(?:LandingPage|Navbar|Footer)\.[A-Za-z_]+/);
    expect(body, 'literal undefined').not.toMatch(/\bundefined\b/);
    expect(body, 'literal NaN').not.toMatch(/\bNaN\b/);

    errors.expectClean();
  });

  test('CTA, header and footer link to the public destinations', async ({ page }) => {
    const errors = watchForErrors(page);
    await page.goto('/');

    const header = page.locator('header');
    await expect(header.getByRole('link', { name: 'StudiQ', exact: true })).toHaveAttribute(
      'href',
      '/',
    );
    const navTargets = [
      { name: 'Funkcje', href: '/features' },
      { name: 'Cennik', href: '/pricing' },
      { name: 'Logowanie', href: '/login' },
      { name: 'Rejestracja', href: '/register' },
    ] as const;
    for (const { name, href } of navTargets) {
      await expect(header.getByRole('link', { name, exact: true })).toHaveAttribute('href', href);
    }

    const hero = sectionWithHeading(page, HERO.title);
    await expect(hero.getByRole('link', { name: HERO.primaryCta, exact: true })).toHaveAttribute(
      'href',
      '/register',
    );
    await expect(hero.getByRole('link', { name: HERO.secondaryCta, exact: true })).toHaveAttribute(
      'href',
      '/features',
    );

    const pricingSection = sectionWithHeading(page, PRICING.title);
    await expect(
      pricingSection.getByRole('link', { name: PRICING.fullPricingCta, exact: true }),
    ).toHaveAttribute('href', '/pricing');

    const bannerSection = sectionWithHeading(page, BANNER.title);
    await expect(
      bannerSection.getByRole('link', { name: BANNER.cta, exact: true }),
    ).toHaveAttribute('href', '/register');

    const footer = page.locator('footer');
    for (const { name, href } of FOOTER.links) {
      await expect(footer.getByRole('link', { name, exact: true })).toHaveAttribute('href', href);
    }

    errors.expectClean();
  });
});
