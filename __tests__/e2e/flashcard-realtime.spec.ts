import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { t } from './utils';

const PASSWORD = 'pass';

const TEACHER_1_EMAIL = 'e2e-teacher1@test.local';
const TEACHER_2_EMAIL = 'e2e-teacher2@test.local';
const STUDENT_EMAILS = Array.from({ length: 5 }, (_, i) => `e2e-student${i + 1}@test.local`);

const FLASHCARD_IDS = Array.from(
  { length: 100 },
  (_, i) => `00000000-0000-4000-8006-${(101 + i).toString().padStart(12, '0')}`,
);

const tStats = (key: string) => t(`EduFlashcardStatsPage.${key}`);
const tLogin = (key: string) => t(`LoginPage.${key}`);

async function login(page: Page, email: string, redirectPattern: RegExp) {
  await page.goto('/login');
  await page.getByLabel(tLogin('email_label')).fill(email);
  await page.getByLabel(tLogin('password_label')).fill(PASSWORD);
  await page.getByRole('button', { name: tLogin('login_button') }).click();
  await page.waitForURL(redirectPattern);
}

async function submitPracticeBatch(page: Page): Promise<number> {
  const items = FLASHCARD_IDS.flatMap((id) =>
    [1, 2, 3].map(() => {
      const rand = Math.random();
      let confidence: number;
      if (rand < 0.1) confidence = 1;
      else if (rand < 0.25) confidence = 2;
      else if (rand < 0.55) confidence = 3;
      else if (rand < 0.8) confidence = 4;
      else confidence = 5;
      return {
        flashcardId: id,
        wasCorrect: confidence >= 3,
        confidenceLevel: confidence,
      };
    }),
  );

  const result = await page.evaluate(async (body) => {
    const res = await fetch('/api/v1/flashcards/batch/practice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: body }),
    });
    return res.json();
  }, items);

  return result.updated ?? 0;
}

async function readStatValue(page: Page, translationKey: string): Promise<string> {
  const label = tStats(translationKey);
  const p = page.locator('p.text-sm').filter({ hasText: label }).first();
  const parent = p.locator('..');
  const value = parent.locator('p.text-3xl');
  return (await value.textContent()) ?? '';
}

test.describe.configure({ mode: 'serial' });

test.describe('Flashcard Realtime Teacher Stats', () => {
  let teacher1Ctx: BrowserContext;
  let teacher1: Page;
  let teacher2Ctx: BrowserContext;
  let teacher2: Page;

  test.afterAll(async () => {
    await teacher1Ctx?.close();
    await teacher2Ctx?.close();
  });

  test('2 teachers see live stats as 5 students study 100 cards 3 times', async ({ browser }) => {
    // 1. Open teacher 1 dashboard
    teacher1Ctx = await browser.newContext();
    teacher1 = await teacher1Ctx.newPage();
    await login(teacher1, TEACHER_1_EMAIL, /\/edu/);
    await teacher1.goto('/edu/flashcards/stats');
    await teacher1.waitForLoadState('networkidle');

    // 2. Open teacher 2 dashboard
    teacher2Ctx = await browser.newContext();
    teacher2 = await teacher2Ctx.newPage();
    await login(teacher2, TEACHER_2_EMAIL, /\/edu/);
    await teacher2.goto('/edu/flashcards/stats');
    await teacher2.waitForLoadState('networkidle');

    // 3. Verify initial state shows 0 practices
    const initialPractices = await readStatValue(teacher1, 'summary_practices');
    expect(initialPractices).toBe('0');

    // 4. Launch 5 student sessions in parallel
    const studentResults = await Promise.all(
      STUDENT_EMAILS.map(async (email) => {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await login(page, email, /\/app/);
        const updated = await submitPracticeBatch(page);
        await ctx.close();
        return updated;
      }),
    );

    studentResults.forEach((count) => {
      expect(count).toBeGreaterThanOrEqual(250);
    });

    const totalPractices = studentResults.reduce((a, b) => a + b, 0);
    expect(totalPractices).toBeGreaterThanOrEqual(1400);

    // 5. Wait for realtime debounce (10s) + buffer
    await teacher1.waitForTimeout(15_000);
    await teacher2.waitForTimeout(15_000);

    // 6. Assert teacher 1 dashboard updated via realtime (no page reload)
    const practicesText = await readStatValue(teacher1, 'summary_practices');
    const practicesNum = parseInt(practicesText, 10);
    expect(practicesNum).toBeGreaterThanOrEqual(totalPractices - 100);

    const studentsText = await readStatValue(teacher1, 'summary_students');
    expect(studentsText).toBe('5');

    // 7. Assert teacher 2 sees identical data (same organization scope)
    const practicesText2 = await readStatValue(teacher2, 'summary_practices');
    expect(practicesText2).toBe(practicesText);

    const studentsText2 = await readStatValue(teacher2, 'summary_students');
    expect(studentsText2).toBe(studentsText);
  });
});
