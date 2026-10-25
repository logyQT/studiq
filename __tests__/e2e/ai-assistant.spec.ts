import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { t } from '#test/e2e/utils';

const PASSWORD = 'pass';
const TEACHER_EMAIL = 'teacher1@dev.local';
const MANAGER_EMAIL = 'manager@dev.local';

async function login(page: Page, email: string, landing: RegExp) {
  await page.goto('/login');
  await page.getByLabel(t('LoginPage.email_label')).fill(email);
  await page.getByLabel(t('LoginPage.password_label')).fill(PASSWORD);
  await page.getByRole('button', { name: t('LoginPage.login_button') }).click();
  await page.waitForURL(landing);
}

/**
 * The reported bug (#134): the teacher sidebar linked to `/edu/ai`, a route that did
 * not exist, so the catch-all rendered the 404 page. The route now exists and every
 * AI nav entry is gated on the `ai.chat` feature, exactly like the student entry.
 */
test.describe('AI assistant routes (#134)', () => {
  test('educator /edu/ai renders the chat instead of the 404 page', async ({ page }) => {
    await login(page, TEACHER_EMAIL, /\/edu/);

    const response = await page.goto('/edu/ai');
    expect(response?.status()).toBe(200);

    // Greeting/composer only exist on the AI page; the 404 page shows neither.
    await expect(page.getByPlaceholder(t('AiChatPage.input_placeholder'))).toBeVisible();
    await expect(page.getByText(t('AiChatPage.suggestion_2'))).toBeVisible();
  });

  test('"Nowa rozmowa" / "Wyczyść czat" reset the conversation to the greeting (#378)', async ({
    page,
  }) => {
    await login(page, TEACHER_EMAIL, /\/edu/);
    await page.goto('/edu/ai');

    const chip = page.getByText(t('AiChatPage.suggestion_2'));
    const clear = page.getByRole('button', { name: t('AiChatPage.clear_chat') });
    const fresh = page.getByRole('button', { name: t('AiChatPage.new_chat') });

    await expect(clear).toHaveCount(0);
    await chip.click();
    await expect(clear).toBeVisible();
    await fresh.click();
    await expect(chip).toBeVisible();
    await expect(clear).toHaveCount(0);

    await chip.click();
    await clear.click();
    await expect(chip).toBeVisible();
    await expect(clear).toHaveCount(0);
  });

  test('educator sidebar shows the AI entry only when ai.chat is entitled', async ({ page }) => {
    await login(page, TEACHER_EMAIL, /\/edu/);

    // Derive the expectation from the live entitlement instead of the seed, so the
    // test stays valid whether or not the fixture account has ai.chat.
    const featuresResponse = await page.request.get('/api/v1/features/me');
    expect(featuresResponse.status()).toBe(200);
    const { features } = (await featuresResponse.json()).data as { features: string[] };

    const aiNav = page.getByRole('link', { name: t('DashboardLayout.ai_chat') });
    if (features.includes('ai.chat')) {
      await expect(aiNav).toHaveCount(1);
      await aiNav.click();
      await page.waitForURL(/\/edu\/ai$/);
    } else {
      await expect(aiNav).toHaveCount(0);
    }
  });

  test('manager sidebar does not advertise the manager AI route', async ({ page }) => {
    await login(page, MANAGER_EMAIL, /\/manage/);

    await expect(
      page.getByRole('link', { name: t('DashboardLayout.manage_overview') }),
    ).toBeVisible();
    // Manager AI is denied by the `/api/v1/ai/*` account-type guard, so the entry
    // that pointed at the never-existing `/manage/ai` is gone rather than dead.
    await expect(page.locator('a[href="/manage/ai"]')).toHaveCount(0);
  });
});
