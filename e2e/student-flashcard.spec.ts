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

  test('Student practices flashcards and completes a session', async ({ page }) => {
    await page.getByRole('link', { name: /^(Flashcards|Fiszki)$/i }).click();
    await page.waitForURL(/\/app\/flashcards/);

    await expect(page.getByText(t('AppFlashcardsPage.title'))).toBeVisible();

    await expect(page.getByText('closure')).toBeVisible();

    await page.getByRole('button', { name: /Start Practice/ }).click();

    await expect(page.getByText(/Card 1 of/)).toBeVisible();

    await expect(page.getByText('Co to jest closure?')).toBeVisible();

    await page.getByText('Co to jest closure?').click();

    await expect(page.getByText('Funkcja, która ma dostęp')).toBeVisible();

    await page.getByRole('button', { name: t('AppFlashcardsPage.got_it') }).click();

    await expect(page.getByText(/Card 2 of/)).toBeVisible();

    await page.getByText(/let.*var/).click();

    await page.getByRole('button', { name: t('AppFlashcardsPage.still_learning') }).click();

    await expect(page.getByText(/Card 3 of/)).toBeVisible();

    await page.getByText(/indeks/).click();

    await page.getByRole('button', { name: t('AppFlashcardsPage.got_it') }).click();

    await expect(page.getByText(/Card 4 of/)).toBeVisible();

    await page.getByText(/macierz/).click();

    await page.getByRole('button', { name: t('AppFlashcardsPage.got_it') }).click();

    await expect(page.getByText(/%\s*$/)).toBeVisible();
    await expect(page.getByRole('button', { name: t('AppFlashcardsPage.practice_again') })).toBeVisible();
  });

  test('Student sees flashcard grid before starting practice', async ({ page }) => {
    await page.getByRole('link', { name: /^(Flashcards|Fiszki)$/i }).click();
    await page.waitForURL(/\/app\/flashcards/);

    await expect(page.getByText('closure')).toBeVisible();
    await expect(page.locator('.font-medium').filter({ hasText: /let.*var/ })).toBeVisible();
    await expect(page.getByText('indeks')).toBeVisible();
    await expect(page.getByText('macierz')).toBeVisible();
  });
});
