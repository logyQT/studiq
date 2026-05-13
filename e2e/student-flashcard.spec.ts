import { test, expect } from '@playwright/test';
import { t } from './utils';

const email = 'student@dev.local';
const password = 'pass';

test.describe('Student Flashcard Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    const emailInput = page.getByLabel(t('LoginPage.email_label'));
    await emailInput.click();
    await emailInput.fill(email);
    await expect(emailInput).toHaveValue(email);
    await page.getByLabel(t('LoginPage.password_label')).fill(password);
    await page.getByRole('button', { name: t('LoginPage.login_button') }).click();
    await page.waitForURL(/\/app/);
  });

  test('manages spaces: create, edit, and delete', async ({ page }) => {
    await page.getByRole('link', { name: /^(Flashcards|Fiszki)$/i }).click();
    await page.waitForURL(/\/app\/flashcards/);

    await page.getByRole('button', { name: /Manage Spaces/ }).click();
    await page.waitForURL(/\/app\/flashcards\/spaces/);

    await page.getByRole('button', { name: /New Space/ }).click();
    await page.getByLabel('Name').fill('Test Space');
    await page.getByLabel('Description').fill('Test description');
    await page.getByRole('checkbox').first().click();
    await page.getByRole('button', { name: /Create/ }).click();

    await expect(page.getByText('Test Space').first()).toBeVisible();
    await expect(page.getByText('1 flashcards').first()).toBeVisible();
    await expect(page.getByText('Test description').first()).toBeVisible();

    await page.getByText('Test Space').hover();
    await page.getByRole('button', { name: /Edit/ }).first().click();

    await page.getByLabel('Name').fill('Updated Space');
    await page.getByRole('button', { name: /Update/ }).click();

    await expect(page.getByText('Updated Space')).toBeVisible();

    await page.getByText('Updated Space').hover();
    await page.getByRole('button', { name: /Delete/ }).first().click();
    await page.getByRole('button', { name: /Delete/ }).last().click();

    await expect(page.getByText('Updated Space')).not.toBeVisible();
  });

  test('practices in endless mode with topics and spaces', async ({ page }) => {
    await page.getByRole('link', { name: /^(Flashcards|Fiszki)$/i }).click();
    await page.waitForURL(/\/app\/flashcards/);

    await page.getByRole('checkbox').first().click();
    await page.getByRole('checkbox').nth(3).click();

    await expect(page.getByRole('button', { name: /Endless/ })).toHaveClass(/border-primary/);

    await page.getByRole('button', { name: /Start Practice/ }).click();
    await page.waitForURL(/\/app\/flashcards\/session/);

    await page.locator('.cursor-pointer').click();
    await page.getByRole('button', { name: t('AppFlashcardsPage.got_it') }).click();

    await expect(page.getByRole('heading', { name: /Session Complete/ })).not.toBeVisible();
    await expect(page.locator('.cursor-pointer')).toBeVisible();

    await page.locator('.cursor-pointer').click();
    await page.getByRole('button', { name: t('AppFlashcardsPage.got_it') }).click();

    await expect(page.getByText(/correct$/)).toBeVisible();
  });

  test('completes limited session after target count', async ({ page }) => {
    await page.getByRole('link', { name: /^(Flashcards|Fiszki)$/i }).click();
    await page.waitForURL(/\/app\/flashcards/);

    await page.getByRole('checkbox').first().click();

    await page.getByRole('button', { name: /Limited/ }).click();

    const targetInput = page.getByRole('spinbutton');
    await targetInput.fill('3');

    await page.getByRole('button', { name: /Start Practice/ }).click();
    await page.waitForURL(/\/app\/flashcards\/session/);

    for (let i = 0; i < 3; i++) {
      await page.locator('.cursor-pointer').click();
      await page.getByRole('button', { name: t('AppFlashcardsPage.got_it') }).click();
    }

    await expect(page.getByRole('heading', { name: /Session Complete/ })).toBeVisible();
    await expect(page.getByText('100%')).toBeVisible();
    await expect(page.getByRole('button', { name: t('AppFlashcardsPage.practice_again') })).toBeVisible();
  });

  test('sees flashcard setup page before starting practice', async ({ page }) => {
    await page.getByRole('link', { name: /^(Flashcards|Fiszki)$/i }).click();
    await page.waitForURL(/\/app\/flashcards/);

    await expect(page.getByRole('heading', { name: 'Flashcards' })).toBeVisible();
    await expect(page.getByText('Topics', { exact: true })).toBeVisible();
    await expect(page.getByText('Your Spaces', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Manage Spaces' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Endless' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Limited' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start Practice' })).toBeVisible();
  });
});
