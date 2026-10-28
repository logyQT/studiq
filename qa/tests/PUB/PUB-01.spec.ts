import { expect, test, type Page } from '@playwright/test';

/**
 * PUB-01 — Strona główna: wygląd i treść (niezalogowany).
 *
 * Prerequisite: no session, Polish UI.
 *
 * The case is a public page, so it needs no tenant data: isolation comes from a
 * brand-new browser context with an explicit `pl` locale cookie and an empty
 * storage state. Nothing here reads or writes shared mutable state (no plans,
 * flags or platform stats are asserted by value), which keeps the run
 * deterministic no matter what the other QA workers are doing.
 */

/** Polish copy asserted by the case (source: `pl.json` → `LandingPage` / `Footer`). */
const COPY = {
  hero: {
    badge: 'Platforma edukacyjna oparta na AI',
    title: 'Tylko to, co musisz umieć.',
    subtitle: 'Testy, fiszki i przygotowanie do egzaminów oparte na AI - dla studentów i uczelni',
    start: 'Zacznij Naukę Za Darmo',
    features: 'Zobacz Funkcje',
  },
  stats: ['Utworzonych pytań', 'Fiszek', 'Aktywnych uczniów', 'Rozwiązanych testów'],
  free: { title: 'Co Otrzymujesz Za Darmo', badge: 'Zawsze za darmo' },
  ai: { title: 'Wspomagaj Naukę z AI', badge: 'Premium i Uczelnie' },
  howItWorks: {
    title: 'Jak to działa',
    desc: 'Trzy proste kroki do efektywnej nauki',
    steps: ['Twórz Treści', 'Ćwicz Regularnie', 'Śledź Postępy'],
  },
  testimonials: {
    title: 'Pokochane przez studentów i nauczycieli',
    authors: ['Maria K.', 'Dr. Tomasz N.'],
  },
  pricing: {
    title: 'Prosty, Przejrzysty Cennik',
    desc: 'Wybierz plan, który Ci odpowiada',
    plans: ['Darmowy', 'Premium', 'Organizacje'],
    cta: 'Zobacz Pełny Cennik',
  },
  banner: {
    title: 'Gotowy na transformację nauki?',
    cta: 'Zacznij za Darmo',
  },
  nav: { login: 'Logowanie', register: 'Rejestracja' },
  footer: {
    tagline: 'Twoja platforma do efektywnej nauki',
    columns: ['Produkt', 'Firma', 'Prawne'],
    links: [
      { name: 'Funkcje', href: '/features' },
      { name: 'Cennik', href: '/pricing' },
      { name: 'Kontakt', href: '/contact' },
      { name: 'Polityka Prywatności', href: '/privacy' },
      { name: 'Regulamin', href: '/terms' },
    ],
    copyright: '© 2026 StudiQ. Wszelkie prawa zastrzeżone.',
  },
} as const;

/** Section order in `apps/web/src/app/page.tsx`, top → bottom. */
const SECTION_ORDER = [
  COPY.free.title,
  COPY.ai.title,
  COPY.howItWorks.title,
  COPY.testimonials.title,
  COPY.pricing.title,
  COPY.banner.title,
];

/** Raw i18n keys (`LandingPage.xxx`) and placeholder values the page must never show. */
const RAW_KEY = /\b[A-Z][A-Za-z]*Page\.[A-Za-z0-9_.]+/;
const PLACEHOLDER = /\b(?:undefined|NaN|null)\b/;

test.describe('PUB-01 — public home page', () => {
  test.use({
    locale: 'pl-PL',
    // A brand-new, signed-out context: no cookies, no storage from any worker.
    storageState: { cookies: [], origins: [] },
  });

  test.beforeEach(async ({ context, baseURL }) => {
    await context.addCookies([
      { name: 'NEXT_LOCALE', value: 'pl', url: baseURL ?? 'http://localhost:3010' },
    ]);
  });

  test('shows every landing section, link and the footer without console errors', async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBe(200);

    // Language + document metadata.
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
    await expect(page).toHaveTitle(COPY.hero.title);

    // Hero.
    const hero = page.locator('section').filter({ has: page.getByRole('heading', { level: 1 }) });
    await expect(hero.getByText(COPY.hero.badge, { exact: true })).toBeVisible();
    await expect(hero.getByRole('heading', { level: 1, name: COPY.hero.title })).toBeVisible();
    await expect(hero.getByText(COPY.hero.subtitle, { exact: true })).toBeVisible();
    const startCta = hero.getByRole('link', { name: COPY.hero.start });
    const featuresCta = hero.getByRole('link', { name: COPY.hero.features });
    await expect(startCta).toBeVisible();
    await expect(startCta).toHaveAttribute('href', '/register');
    await expect(featuresCta).toBeVisible();
    await expect(featuresCta).toHaveAttribute('href', '/features');

    // Anonymous header: only the public entry points, no account menu.
    const header = page.locator('header');
    const loginLink = header
      .getByRole('link', { name: COPY.nav.login })
      .filter({ visible: true })
      .first();
    await expect(loginLink).toBeVisible();
    await expect(loginLink).toHaveAttribute('href', '/login');
    const registerLink = header
      .getByRole('link', { name: COPY.nav.register })
      .filter({ visible: true })
      .first();
    await expect(registerLink).toBeVisible();
    await expect(registerLink).toHaveAttribute('href', '/register');

    // Statistics: labels plus a real numeric value (never `NaN`/`undefined`).
    const stats = page.locator('section').filter({ hasText: COPY.stats[0] });
    for (const label of COPY.stats) {
      const labelEl = stats.getByText(label, { exact: true });
      await expect(labelEl).toBeVisible();
      const valueEl = labelEl.locator('xpath=preceding-sibling::div[1]');
      await expect(valueEl).toBeVisible();
      await expect(valueEl).toHaveText(/^\d[\d,]*\+$/);
    }

    // Named sections, top to bottom.
    for (const name of SECTION_ORDER) {
      await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
    }
    const sectionTops: number[] = [];
    for (const name of SECTION_ORDER) {
      const box = await page.getByRole('heading', { level: 2, name }).boundingBox();
      expect(box, `heading "${name}" should be rendered`).not.toBeNull();
      sectionTops.push(box!.y);
    }
    expect(sectionTops).toEqual([...sectionTops].sort((a, b) => a - b));

    // "Jak to działa" — three numbered steps.
    const howItWorks = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { level: 2, name: COPY.howItWorks.title }) });
    await expect(howItWorks.getByText(COPY.howItWorks.desc, { exact: true })).toBeVisible();
    for (const [index, step] of COPY.howItWorks.steps.entries()) {
      await expect(howItWorks.getByText(`Krok ${index + 1}`, { exact: true })).toBeVisible();
      await expect(howItWorks.getByRole('heading', { level: 3, name: step })).toBeVisible();
    }

    // Free and AI feature sections.
    const free = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { level: 2, name: COPY.free.title }) });
    await expect(free.getByText(COPY.free.badge, { exact: true })).toBeVisible();
    const ai = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { level: 2, name: COPY.ai.title }) });
    await expect(ai.getByText(COPY.ai.badge, { exact: true })).toBeVisible();

    // Testimonials.
    const testimonials = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { level: 2, name: COPY.testimonials.title }) });
    for (const author of COPY.testimonials.authors) {
      await expect(testimonials.getByText(author, { exact: true })).toBeVisible();
    }

    // Pricing section (plan names are static copy; prices come from the shared
    // catalogue and are deliberately not asserted by value).
    const pricing = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { level: 2, name: COPY.pricing.title }) });
    await expect(pricing.getByText(COPY.pricing.desc, { exact: true })).toBeVisible();
    for (const plan of COPY.pricing.plans) {
      await expect(pricing.getByText(plan, { exact: true })).toBeVisible();
    }
    await expect(pricing.getByRole('link', { name: COPY.pricing.cta })).toHaveAttribute(
      'href',
      '/pricing',
    );

    // Closing CTA banner.
    const banner = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { level: 2, name: COPY.banner.title }) });
    await expect(banner.getByRole('link', { name: COPY.banner.cta })).toHaveAttribute(
      'href',
      '/register',
    );

    // Scroll the whole page from top to footer, like the manual step.
    await scrollToBottom(page);

    const footer = page.locator('footer');
    await expect(footer).toBeInViewport();
    await expect(footer.getByText(COPY.footer.tagline, { exact: true })).toBeVisible();
    for (const column of COPY.footer.columns) {
      await expect(footer.getByRole('heading', { level: 3, name: column })).toBeVisible();
    }
    for (const link of COPY.footer.links) {
      await expect(footer.getByRole('link', { name: link.name, exact: true })).toHaveAttribute(
        'href',
        link.href,
      );
    }
    await expect(footer.getByText(COPY.footer.copyright, { exact: true })).toBeVisible();

    // No untranslated keys or placeholder values anywhere on the page.
    const visibleText = await page.evaluate(() => document.body.innerText);
    expect(visibleText).not.toMatch(RAW_KEY);
    expect(visibleText).not.toMatch(PLACEHOLDER);

    // Let the page's data fetches settle so late console errors are attributed
    // to this view, then assert the console stayed clean.
    await page.waitForLoadState('networkidle');

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});

/** Real wheel scrolling from the top of the page down to the footer. */
async function scrollToBottom(page: Page): Promise<void> {
  for (let step = 0; step < 60; step += 1) {
    const position = await page.evaluate(() => ({
      y: window.scrollY,
      max: document.documentElement.scrollHeight - window.innerHeight,
    }));
    if (position.y >= position.max - 1) return;
    await page.mouse.wheel(0, 700);
    await page.waitForFunction((previous) => window.scrollY > previous, position.y, {
      timeout: 5_000,
    });
  }
  throw new Error('page did not scroll to the bottom');
}
