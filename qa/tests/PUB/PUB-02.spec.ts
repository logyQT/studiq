import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * PUB-02 — public „Funkcje” page (/features).
 *
 * Prerequisite: no session. The case uses no tenant data, so the spec stays
 * fully anonymous; the case's deterministic tenant (`PUB-02.md::PUB-02::qa-shared`)
 * exists for the suite's bookkeeping but nothing here reads or mutates it.
 *
 * The comparison table renders its values as text for assistive technology
 * (`ComparisonCell`, #291/#639): an included feature is „Tak”, a missing one is
 * „— Nie”. The assertions therefore read the cell text, not the decorative icon.
 */

const PLAN_LABELS = ['Darmowy', 'Premium', 'Uniwersytecki'] as const;

function featureCard(page: Page, title: string): Locator {
  return page.locator('[data-slot="card"]').filter({ has: page.getByText(title, { exact: true }) });
}

function comparisonRow(page: Page, feature: string): Locator {
  return page
    .locator('table tbody tr')
    .filter({ has: page.getByRole('rowheader', { name: feature, exact: true }) });
}

async function expectIncluded(cell: Locator): Promise<void> {
  await expect(cell).toContainText('Tak');
}

async function expectMissing(cell: Locator): Promise<void> {
  await expect(cell).toContainText('—');
  await expect(cell).toContainText('Nie');
}

test.describe('PUB-02 — public /features page', () => {
  test('shows the feature catalogue, the plan comparison and a working free-signup CTA', async ({
    page,
  }) => {
    const response = await page.goto('/features');
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/features$/);

    // No session required: the public header is rendered instead of a login redirect.
    await expect(page.getByRole('link', { name: 'Logowanie' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Rejestracja' })).toBeVisible();

    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'Wszystko Czego Potrzebujesz, Aby Odnieść Sukces',
      }),
    ).toBeVisible();
    await expect(page.getByText('Od podstawowych fiszek po egzaminy oparte na AI')).toBeVisible();

    // Every feature card carries exactly one plan badge, and the badge is one of the
    // three documented plans.
    const cards = page.locator('[data-slot="card"]');
    const cardCount = await cards.count();
    expect(cardCount).toBeGreaterThan(0);
    for (let index = 0; index < cardCount; index += 1) {
      const badge = cards.nth(index).locator('[data-slot="badge"]');
      await expect(badge).toHaveCount(1);
      expect(PLAN_LABELS).toContain((await badge.innerText()).trim());
    }

    // The examples named by the case: title + plan label.
    for (const [title, plan] of [
      ['Ręczne Tworzenie Pytań', 'Darmowy'],
      ['Generowanie Pytań przez AI', 'Premium'],
      ['Zarządzanie Organizacją', 'Uniwersytecki'],
    ] as const) {
      const card = featureCard(page, title);
      await expect(card, `card ${title}`).toHaveCount(1);
      await expect(card.locator('[data-slot="badge"]')).toHaveText(plan);
    }

    // Plan comparison table: three plan columns, every row has one value per plan.
    const table = page.locator('table');
    await expect(table).toBeVisible();
    await expect(table.locator('caption')).toHaveText('Porównanie Planów');
    await expect(table.locator('thead th')).toHaveText([
      'Funkcja',
      'Darmowy',
      'Premium',
      'Uniwersytecki',
    ]);

    const tableRows = table.locator('tbody tr');
    expect(await tableRows.count()).toBeGreaterThanOrEqual(3);
    for (const row of await tableRows.all()) {
      await expect(row.locator('td')).toHaveCount(3);
    }

    // Free-tier row: available on all three plans.
    const manualRow = comparisonRow(page, 'Ręczne Tworzenie Pytań');
    await expect(manualRow).toHaveCount(1);
    await expectIncluded(manualRow.locator('td').nth(0));
    await expectIncluded(manualRow.locator('td').nth(1));
    await expectIncluded(manualRow.locator('td').nth(2));

    // Premium-only row: missing on Darmowy, present on Premium and Uniwersytecki.
    const aiRow = comparisonRow(page, 'Generowanie Pytań przez AI');
    await expect(aiRow).toHaveCount(1);
    await expectMissing(aiRow.locator('td').nth(0));
    await expectIncluded(aiRow.locator('td').nth(1));
    await expectIncluded(aiRow.locator('td').nth(2));

    // University-only row: missing on Darmowy and Premium, present on Uniwersytecki.
    const universityRow = comparisonRow(page, 'Zarządzanie Organizacją');
    await expect(universityRow).toHaveCount(1);
    await expectMissing(universityRow.locator('td').nth(0));
    await expectMissing(universityRow.locator('td').nth(1));
    await expectIncluded(universityRow.locator('td').nth(2));

    // Closing call-to-action: „Zacznij Za Darmo” opens the registration page.
    await expect(
      page.getByRole('heading', { level: 2, name: 'Gotowy, Aby Zacząć Naukę?' }),
    ).toBeVisible();
    const cta = page.getByRole('link', { name: 'Zacznij Za Darmo' });
    await expect(cta).toHaveCount(1);
    await expect(cta).toHaveAttribute('href', '/register');

    await cta.click();
    await expect(page).toHaveURL(/\/register$/);
    await expect(page.getByText('Utwórz konto', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Adres e-mail')).toBeVisible();
  });
});
