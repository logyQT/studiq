import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { t } from '#test/e2e/utils';

const PASSWORD = 'pass';
const TEACHER_EMAIL = 'teacher1@dev.local';
const STUDENT_EMAIL = 'student1@dev.local';
const MANAGER_EMAIL = 'manager@dev.local';

async function login(page: Page, email: string, landing: RegExp) {
  await page.goto('/login');
  await page.getByLabel(t('LoginPage.email_label')).fill(email);
  await page.getByLabel(t('LoginPage.password_label')).fill(PASSWORD);
  await page.getByRole('button', { name: t('LoginPage.login_button') }).click();
  await page.waitForURL(landing);
}

/** Live entitlement, so the spec documents both states without hardcoding a seed. */
async function aiChatEntitled(page: Page): Promise<boolean> {
  const res = await page.request.get('/api/v1/features/me');
  expect(res.status()).toBe(200);
  const { features } = (await res.json()).data as { features: string[] };
  return features.includes('ai.chat');
}

/**
 * The reported bug (#134): the teacher sidebar linked to `/edu/ai`, a route that did
 * not exist, so the catch-all rendered the 404 page. The route now exists and every
 * AI nav entry is gated on the `ai.chat` feature, exactly like the student entry.
 */
test.describe('AI assistant routes (#134)', () => {
  test('educator /edu/ai renders the AI page instead of the 404 page', async ({ page }) => {
    await login(page, TEACHER_EMAIL, /\/edu/);

    const response = await page.goto('/edu/ai');
    expect(response?.status()).toBe(200);

    if (await aiChatEntitled(page)) {
      // Greeting/composer only exist on the AI page; the 404 page shows neither.
      await expect(page.getByPlaceholder(t('AiChatPage.input_placeholder'))).toBeVisible();
      await expect(page.getByText(t('AiChatPage.suggestion_2'))).toBeVisible();
    } else {
      // #375: not entitled → the plan gate, never the 404 page.
      await expect(page.getByText(t('AiChatPage.locked_title'))).toBeVisible();
      await expect(page.getByText(t('AiChatPage.locked_desc'))).toBeVisible();
      await expect(page.getByRole('button', { name: t('AiChatPage.locked_cta') })).toBeVisible();
      await expect(page.getByPlaceholder(t('AiChatPage.input_placeholder'))).toHaveCount(0);
      await expect(page.getByText(t('AiChatPage.suggestion_2'))).toHaveCount(0);
    }
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

/**
 * #375: a Base-plan account reaches `/app/ai` directly (no sidebar entry), the old
 * page rendered an enabled composer and `POST /api/v1/ai/chat` answered 429 with no
 * feedback. The page must show the plan gate and must not spend an AI request.
 */
test.describe('AI assistant plan gate (#375)', () => {
  test('base-plan student sees the locked state, not a silent 429', async ({ page }) => {
    await login(page, STUDENT_EMAIL, /\/app/);
    // Seed fixture: personal `base`, active org WSB Merito (`launch`) → no ai.chat.
    expect(await aiChatEntitled(page), 'fixture account must not have ai.chat').toBe(false);

    const aiRequests: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/v1/ai/')) aiRequests.push(r.url());
    });

    const response = await page.goto('/app/ai');
    expect(response?.status()).toBe(200);

    await expect(page.getByText(t('AiChatPage.locked_title'))).toBeVisible();
    await expect(page.getByText(t('AiChatPage.locked_desc'))).toBeVisible();
    await expect(page.locator('textarea')).toHaveCount(0);
    await expect(page.getByText(t('AiChatPage.disclaimer'))).toHaveCount(0);
    await expect(page.getByText(t('AiChatPage.suggestion_2'))).toHaveCount(0);
    // No `/api/v1/ai/usage` and, above all, no `POST /api/v1/ai/chat`.
    expect(aiRequests).toEqual([]);

    await page.getByRole('button', { name: t('AiChatPage.locked_cta') }).click();
    await page.waitForURL(/\/pricing$/);
  });
});

/**
 * #386: the deck toolbar linked to `/app/ai?deckId=…`, but nothing read the
 * parameter, so the chat could only save generated cards into a brand-new deck.
 * The chat now shows the target deck and saves into it.
 */
test.describe('AI assistant deck context (#386)', () => {
  const STUDENT_DECK_ID = '00000000-0000-4000-8006-000000000003';
  const STUDENT_DECK_NAME = 'O1S1';
  const TEACHER_DECK_ID = '00000000-0000-4000-8006-000000000001';
  const TEACHER_DECK_NAME = 'O1G1T1';

  test('student opening the chat with ?deckId shows the target deck', async ({ page }) => {
    await login(page, STUDENT_EMAIL, /\/app/);

    await page.goto(`/app/ai?deckId=${STUDENT_DECK_ID}`);

    if (!(await aiChatEntitled(page))) {
      // #375: the plan gate wins even with a valid deck id; no deck target, no composer.
      await expect(page.getByText(t('AiChatPage.locked_title'))).toBeVisible();
      await expect(page.getByText(t('AiChatPage.deck_context_target'))).toHaveCount(0);
      await expect(page.getByPlaceholder(t('AiChatPage.input_placeholder'))).toHaveCount(0);
      return;
    }

    await expect(page.getByPlaceholder(t('AiChatPage.input_placeholder'))).toBeVisible();
    await expect(page.getByText(t('AiChatPage.deck_context_target'))).toBeVisible();
    await expect(page.getByText(STUDENT_DECK_NAME, { exact: true })).toBeVisible();
  });

  test('student can drop the deck target and fall back to a new deck', async ({ page }) => {
    await login(page, STUDENT_EMAIL, /\/app/);

    await page.goto(`/app/ai?deckId=${STUDENT_DECK_ID}`);

    if (!(await aiChatEntitled(page))) {
      // #375: the lock replaces the deck bar, so there is nothing to drop.
      await expect(page.getByText(t('AiChatPage.locked_title'))).toBeVisible();
      await expect(
        page.getByRole('button', { name: t('AiChatPage.deck_context_new') }),
      ).toHaveCount(0);
      return;
    }

    await page.getByRole('button', { name: t('AiChatPage.deck_context_new') }).click();

    await page.waitForURL(/\/app\/ai$/);
    await expect(page.getByText(t('AiChatPage.deck_context_target'))).toHaveCount(0);
    await expect(page.getByText(STUDENT_DECK_NAME, { exact: true })).toHaveCount(0);
  });

  test('educator opening /edu/ai with ?deckId is not bounced and shows the deck', async ({
    page,
  }) => {
    await login(page, TEACHER_EMAIL, /\/edu/);

    await page.goto(`/edu/ai?deckId=${TEACHER_DECK_ID}`);

    if (!(await aiChatEntitled(page))) {
      // #375: the route still resolves (not bounced) but renders the plan gate.
      await expect(page).toHaveURL(new RegExp(`/edu/ai\\?deckId=${TEACHER_DECK_ID}$`));
      await expect(page.getByText(t('AiChatPage.locked_title'))).toBeVisible();
      await expect(page.getByText(t('AiChatPage.deck_context_target'))).toHaveCount(0);
      await expect(page.getByPlaceholder(t('AiChatPage.input_placeholder'))).toHaveCount(0);
      return;
    }

    await expect(page.getByPlaceholder(t('AiChatPage.input_placeholder'))).toBeVisible();
    await expect(page.getByText(t('AiChatPage.deck_context_target'))).toBeVisible();
    await expect(page.getByText(TEACHER_DECK_NAME, { exact: true })).toBeVisible();
  });

  test('deck toolbar keeps the dashboard and forwards deckId', async ({ page }) => {
    await login(page, STUDENT_EMAIL, /\/app/);

    const featuresResponse = await page.request.get('/api/v1/features/me');
    expect(featuresResponse.status()).toBe(200);
    const { features } = (await featuresResponse.json()).data as { features: string[] };
    test.skip(!features.includes('ai.chat'), 'ai.chat is not entitled for this fixture account');

    await page.goto(`/app/flashcards/${STUDENT_DECK_ID}`);
    await page.getByRole('button', { name: t('AppFlashcardDeckViewPage.generate') }).click();

    await page.waitForURL(new RegExp(`/app/ai\\?deckId=${STUDENT_DECK_ID}$`));
    await expect(page.getByText(t('AiChatPage.deck_context_target'))).toBeVisible();
  });

  test('educator deck toolbar links to /edu/ai instead of /app/ai', async ({ page }) => {
    await login(page, TEACHER_EMAIL, /\/edu/);

    const featuresResponse = await page.request.get('/api/v1/features/me');
    expect(featuresResponse.status()).toBe(200);
    const { features } = (await featuresResponse.json()).data as { features: string[] };
    test.skip(!features.includes('ai.chat'), 'ai.chat is not entitled for this fixture account');

    await page.goto(`/edu/flashcards/${TEACHER_DECK_ID}`);
    await page.getByRole('button', { name: t('EduDeckViewPage.generate') }).click();

    await page.waitForURL(new RegExp(`/edu/ai\\?deckId=${TEACHER_DECK_ID}$`));
    await expect(page.getByText(t('AiChatPage.deck_context_target'))).toBeVisible();
  });
});
