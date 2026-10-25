import { expect, type Page, test } from '@playwright/test';
import { t } from '#test/e2e/utils';

const PASSWORD = 'pass';
const WSB_MERITO = 'WSB Merito';

type MeOrg = { id: string; name: string; orgRoleName: string };

async function login(page: Page, email: string, landing: RegExp) {
  await page.goto('/login');
  await page.getByLabel(t('LoginPage.email_label')).fill(email);
  await page.getByLabel(t('LoginPage.password_label')).fill(PASSWORD);
  await page.getByRole('button', { name: t('LoginPage.login_button') }).click();
  await page.waitForURL(landing);
}

/**
 * The seeded org ids live in `supabase/seeds/01_seed.sql`, but the checkout must
 * be reachable for whatever org the account really belongs to. Resolve it from
 * the same endpoint the page uses, after the dashboard settled the active org.
 */
async function myOrgs(page: Page): Promise<MeOrg[]> {
  return page.evaluate(async () => {
    const res = await fetch('/api/v1/me/orgs');
    const json = await res.json();
    return json.data as MeOrg[];
  });
}

function checkoutUrl(planId: string, orgId?: string) {
  const params = new URLSearchParams({ plan_id: planId });
  if (orgId) params.set('org_id', orgId);
  return `/checkout?${params.toString()}`;
}

/** Fill the mock card so the submit button becomes enabled. Never submit it. */
async function fillTestCard(page: Page) {
  await page.locator('#cardNumber').fill('4242424242424242');
  await page.locator('#expiry').fill('1230');
  await page.locator('#cvc').fill('123');
  await page.locator('#cardName').fill('M1 Manager');
}

test.describe('Org checkout shows the target organization (#225)', () => {
  test('multi-org manager sees the org named in the URL', async ({ page }) => {
    await login(page, 'manager@dev.local', /\/manage/);

    const org = (await myOrgs(page)).find((o) => o.name === WSB_MERITO);
    expect(org).toBeDefined();

    await page.goto(checkoutUrl('hub', org!.id));

    await expect(page.getByText(t('CheckoutPage.target_org_hint'))).toBeVisible();
    await expect(page.getByText(WSB_MERITO).first()).toBeVisible();
    await expect(page.getByText(t('CheckoutPage.benefits_title'))).toBeVisible();
    await expect(page.getByText(t('CheckoutPage.total'))).toBeVisible();

    await fillTestCard(page);
    await expect(page.locator('button[type="submit"]')).toBeEnabled();
  });

  test('single-org manager sees the same org block', async ({ page }) => {
    await login(page, 'manager2@dev.local', /\/manage/);

    const orgs = await myOrgs(page);
    expect(orgs).toHaveLength(1);

    await page.goto(checkoutUrl('hub', orgs[0].id));

    await expect(page.getByText(t('CheckoutPage.target_org_hint'))).toBeVisible();
    await expect(page.getByText(orgs[0].name).first()).toBeVisible();

    await fillTestCard(page);
    await expect(page.locator('button[type="submit"]')).toBeEnabled();
  });

  test('a non-admin member is told why they cannot buy', async ({ page }) => {
    await login(page, 'teacher1@dev.local', /\/edu/);

    const org = (await myOrgs(page)).find((o) => o.name === WSB_MERITO);
    expect(org).toBeDefined();
    expect(org!.orgRoleName).not.toBe('admin');

    await page.goto(checkoutUrl('hub', org!.id));

    await expect(page.getByText(t('CheckoutPage.org_not_admin_title'))).toBeVisible();
    await expect(page.getByText(WSB_MERITO).first()).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toHaveCount(0);
  });

  test('an org checkout without org_id is blocked', async ({ page }) => {
    await login(page, 'manager@dev.local', /\/manage/);

    await page.goto(checkoutUrl('hub'));

    await expect(page.getByText(t('CheckoutPage.org_missing_title'))).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toHaveCount(0);
  });
});
