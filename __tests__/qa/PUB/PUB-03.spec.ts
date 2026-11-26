import { json } from '#test/helpers/json';
import pl from '@/i18n/messages/pl.json';
import { expect, test, type Page } from '@playwright/test';
import { createTranslator } from 'next-intl';

/**
 * PUB-03 — Strona „Cennik” (/pricing) – wybór odbiorcy cennika.
 *
 * Mapping note (the redesign, `feat/pricing-design-system`): the case was written
 * for three account-type tiles that each opened their own route
 * (`/pricing/student`, `/pricing/edu`, `/pricing/org`). Those routes are gone and
 * the page is one URL, so the case's subject — “which catalogue do I get, and how
 * do I get to the other one?” — is now the two-option audience switch:
 * „Dla siebie” (the one individual ladder) and „Dla organizacji” (the
 * organization ladder). The case ID and its acceptance intent are unchanged.
 * #1193 removed the student/educator split: „Dla siebie” is one ladder,
 * Free / Plus / Pro / Max, for every persona.
 *
 * Prerequisite is "Brak sesji": the pricing page is public, so the spec runs in an
 * empty storage state and never signs in. PUB-03's isolated tenant
 * (`qa/cases/PUB-03.md::PUB-03::qa-shared`, seeded with
 * `bun scripts/qa-tenant.ts PUB-03`) exists per case but is deliberately not used
 * for a session — the acceptance criteria belong to the anonymous visitor.
 *
 * The plan catalogue is global product config. The spec reads it through the
 * public `GET /api/v1/subscription-plans` endpoint (no scope/audience filter: one
 * flat list, which is what the page itself requests) and compares the rendered
 * ladders with it; no plan, setting or other singleton row is written. Page copy
 * comes from the `PricingPage` message catalogue the page renders from, so a
 * rewording does not turn the spec red — which plans and which ladder each
 * audience shows does.
 */

const copy = createTranslator({ locale: 'pl', messages: pl, namespace: 'PricingPage' });

interface PlanInfo {
  key: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  scope: string;
  audience: string | null;
}

/** The two ladders the pricing page documents, per scope. */
const LADDERS = [
  { scope: 'personal', plans: ['base', 'spark', 'ace', 'pro'] },
  { scope: 'organization', plans: ['launch', 'hub', 'campus'] },
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

/** `StudiQ Plus` → `Plus`: the page names the tier in its own column. */
function shortPlanName(name: string): string {
  return name.replace(/^StudiQ\s+/i, '').trim();
}

/** The catalogue's own order for one scope ladder. */
function ladder(plans: PlanInfo[], scope: string): PlanInfo[] {
  return plans
    .filter((plan) => plan.isActive && plan.scope === scope)
    .toSorted((a, b) => a.sortOrder - b.sortOrder);
}

async function fetchCatalogue(page: Page): Promise<PlanInfo[]> {
  const response = await page.request.get('/api/v1/subscription-plans');
  expect(response.status(), 'the public plan catalogue').toBe(200);
  return (await json<{ data: PlanInfo[] }>(response)).data;
}

/** The ladder section the page renders under one heading. */
function ladderSection(page: Page, title: string) {
  return page
    .locator('#pricing-plans section')
    .filter({ has: page.getByRole('heading', { level: 2, name: title, exact: true }) });
}

/**
 * One ladder is the catalogue's plans, in catalogue order, one `<li>` each with
 * the plan's own `h3` handle and a way to act on it.
 */
async function expectLadder(page: Page, title: string, plans: PlanInfo[]) {
  const section = ladderSection(page, title);
  await expect(section, `the "${title}" ladder`).toHaveCount(1);
  await expect(
    section.getByRole('heading', { level: 2, name: title, exact: true }),
    `the "${title}" heading`,
  ).toBeVisible();

  const rows = section.locator('ul > li');
  await expect(rows, `the "${title}" plan rows`).toHaveCount(plans.length);

  const rendered = await section
    .locator('ul > li h3[id]')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({ key: node.getAttribute('id'), name: node.textContent.trim() })),
    );
  expect(rendered, `the "${title}" rows follow the catalogue`).toEqual(
    plans.map((plan) => ({ key: plan.key, name: shortPlanName(plan.name) })),
  );

  // A row is a plan, not a heading: every one of them carries an action.
  await expect(section.locator('ul > li a, ul > li button')).toHaveCount(plans.length);
}

test.describe('@case:PUB-03 @area:PUB @prio:P1 pricing audience switch', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ context, baseURL }) => {
    // A returning Polish visitor: the app's default locale, pinned explicitly so
    // a stale profile cookie can never switch the copy under the assertions.
    const { hostname } = new URL(baseURL!);
    await context.addCookies([{ name: 'NEXT_LOCALE', value: 'pl', domain: hostname, path: '/' }]);
  });

  test('one page shows the individual ladder and swaps to the organization one in place', async ({
    page,
  }) => {
    const errors = watchForErrors(page);

    const response = await page.goto('/pricing');
    expect(response?.status(), 'document status').toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
    await expect(page).toHaveTitle(`${copy('title')} | StudiQ`);

    // Prerequisite "Brak sesji": the visitor is not authenticated.
    const me = await page.request.get('/api/v1/auth/me');
    expect(me.status()).toBe(200);
    const meBody = await json<{ data?: { user?: unknown } }>(me);
    expect(meBody.data?.user ?? null).toBeNull();

    // The page the case was written against had one `h1` and three tiles; it still
    // has one `h1`, and the picker is now the segmented audience control.
    await expect(
      page.getByRole('heading', { level: 1, name: copy('title'), exact: true }),
    ).toBeVisible();
    await expect(page.getByText(copy('subtitle'), { exact: true })).toBeVisible();

    const catalogue = await fetchCatalogue(page);
    for (const entry of LADDERS) {
      expect(
        ladder(catalogue, entry.scope).map((plan) => plan.key),
        `the ${entry.scope} ladder in the catalogue`,
      ).toEqual([...entry.plans]);
    }

    // The two-option switch: a named radio group, not a card grid.
    const group = page.getByRole('group', { name: copy('switch_legend'), exact: true });
    await expect(group).toBeVisible();
    await expect(group.getByRole('radio')).toHaveCount(2);
    const individualRadio = group.getByRole('radio', {
      name: copy('audience_individual'),
      exact: true,
    });
    const organizationRadio = group.getByRole('radio', {
      name: copy('audience_organization'),
      exact: true,
    });
    await expect(individualRadio, 'the default audience').toBeChecked();
    await expect(organizationRadio).not.toBeChecked();

    // The one individual ladder, exactly the catalogue's plans, in its order.
    const individualPlans = ladder(catalogue, 'personal');
    const organizationPlans = ladder(catalogue, 'organization');
    await expectLadder(page, copy('ladder_individual_title'), individualPlans);

    // The organization ladder is not on the page in this view.
    await expect(page.locator('#pricing-plans h3#launch')).toHaveCount(0);
    await expect(ladderSection(page, copy('ladder_org_title'))).toHaveCount(0);

    // --- Switching in place: no navigation, no lost scroll position ---------
    const documentRequests: string[] = [];
    page.on('request', (request) => {
      if (request.resourceType() === 'document') documentRequests.push(request.url());
    });

    // A marker on the live document survives a client-side swap and dies with a
    // document load; the scroll offset is what the reader must not lose.
    await page.evaluate(() => {
      document.documentElement.dataset.pub03 = 'same-document';
      window.scrollTo(0, 100);
    });
    const scrollBefore = await page.evaluate(() => window.scrollY);
    expect(scrollBefore, 'the page started scrolled').toBeGreaterThan(0);

    await group
      .locator('label')
      .filter({ hasText: copy('audience_organization') })
      .click();
    await expect(page).toHaveURL(/\/pricing\?audience=organization$/);
    await expectLadder(page, copy('ladder_org_title'), organizationPlans);

    expect(
      await page.evaluate(() => document.documentElement.dataset.pub03),
      'the audience switch is a client swap, not a document load',
    ).toBe('same-document');
    expect(documentRequests, 'the switch issues no document request').toEqual([]);
    const scrollAfter = await page.evaluate(() => window.scrollY);
    expect(
      Math.abs(scrollAfter - scrollBefore),
      `scroll position ${scrollBefore} → ${scrollAfter}`,
    ).toBeLessThanOrEqual(2);

    // The individual ladder is gone, and the switch follows the address.
    await expect(page.locator('#pricing-plans h3#base')).toHaveCount(0);
    await expect(ladderSection(page, copy('ladder_individual_title'))).toHaveCount(0);
    await expect(organizationRadio).toBeChecked();

    // --- Back undoes the switch ---------------------------------------------
    // The address is the audience, so leaving the organization ladder is one Back
    // away, the same way the reader arrived.
    await page.goBack();
    await expect(page).toHaveURL(/\/pricing$/);
    await expectLadder(page, copy('ladder_individual_title'), individualPlans);
    await expect(page.locator('#pricing-plans h3#launch')).toHaveCount(0);
    await expect(individualRadio).toBeChecked();

    await page.goForward();
    await expect(page).toHaveURL(/\/pricing\?audience=organization$/);
    await expectLadder(page, copy('ladder_org_title'), organizationPlans);

    // Back to individual: the address drops the parameter again.
    await group
      .locator('label')
      .filter({ hasText: copy('audience_individual') })
      .click();
    await expect(page).toHaveURL(/\/pricing$/);
    await expectLadder(page, copy('ladder_individual_title'), individualPlans);
    await expect(page.locator('#pricing-plans h3#launch')).toHaveCount(0);

    // --- Back/Forward follow the address, not a remembered choice -----------
    await page.goto('/pricing?audience=organization');
    await expect(page.locator('#pricing-plans h3#launch')).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/\/pricing$/);
    await expect(page.locator('#pricing-plans h3#base')).toBeVisible();
    await expect(page.locator('#pricing-plans h3#launch')).toHaveCount(0);

    await page.goForward();
    await expect(page).toHaveURL(/\/pricing\?audience=organization$/);
    await expect(page.locator('#pricing-plans h3#launch')).toBeVisible();
    await expect(page.locator('#pricing-plans h3#base')).toHaveCount(0);

    // --- A deep link is the ladder in the server HTML, not only after hydration
    const organizationHtml = await (
      await page.request.get('/pricing?audience=organization')
    ).text();
    expect(
      organizationHtml,
      'a cold ?audience=organization response contains the organization ladder',
    ).toContain(`>${copy('ladder_org_title')}</h2>`);
    expect(organizationHtml, 'and not the individual ladder').not.toContain(
      `>${copy('ladder_individual_title')}</h2>`,
    );
    /*
     * The rows and their prices are the page's promise to a crawler: the heading
     * alone is true of a client-fetched ladder too (#1272). The handles are the
     * plan keys the catalogue renders (`#launch` … `#campus`).
     */
    for (const key of ['launch', 'hub', 'campus']) {
      expect(organizationHtml, `the ${key} row is in the response`).toContain(`id="${key}"`);
    }
    expect(organizationHtml, 'with its price').toContain(copy('period_month'));
    expect(organizationHtml, 'and no individual row').not.toContain('id="base"');
    const organizationRadioTag = /<input[^>]*value="organization"[^>]*>/.exec(
      organizationHtml,
    )?.[0];
    expect(organizationRadioTag, 'the organization segment is in the response').toBeTruthy();
    expect(organizationRadioTag, 'and is the chosen one').toContain('checked');

    const individualHtml = await (await page.request.get('/pricing')).text();
    expect(individualHtml, 'the default response contains the individual ladder').toContain(
      `>${copy('ladder_individual_title')}</h2>`,
    );
    expect(individualHtml, 'and not the organization ladder').not.toContain(
      `>${copy('ladder_org_title')}</h2>`,
    );
    for (const key of ['base', 'spark', 'ace', 'pro']) {
      expect(individualHtml, `the ${key} row is in the response`).toContain(`id="${key}"`);
    }
    for (const retired of ['lite', 'guide', 'creator', 'master', 'solo', 'team']) {
      expect(individualHtml, `the retired ${retired} row is absent`).not.toContain(
        `id="${retired}"`,
      );
    }
    expect(individualHtml, 'with prices').toContain(copy('period_month'));
    expect(individualHtml, 'and no organization row').not.toContain('id="launch"');
    const individualRadioTag = /<input[^>]*value="individual"[^>]*>/.exec(individualHtml)?.[0];
    expect(individualRadioTag, 'the individual segment is the chosen one by default').toContain(
      'checked',
    );

    errors.expectClean();
  });
});
