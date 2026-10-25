import { expect, type Page, test } from '@playwright/test';
import { t } from '#test/e2e/utils';

/**
 * E2E coverage for #460 (EDU-ST-01).
 *
 * `/edu/stats/data` used to render "Wszyscy uczniowie" = distinct practisers,
 * so the seeded Classroom organization (1 enrolled student, 0 practices) showed
 * a bare 0. The card now shows the group roster as its value and the
 * practising count as "Aktywnych: N", and a teacher practising their own deck
 * no longer moves either number.
 *
 * The Playwright suite runs `fullyParallel` against one seeded database, so the
 * assertions read the baseline from the API and compare deltas.
 */

const PASSWORD = 'pass';
const TEACHER_EMAIL = 'teacher-classroom@dev.local';
const STUDENT_EMAIL = 'student-classroom@dev.local';

/** First seeded Classroom flashcard (Historia — „Kiedy miała miejsce bitwa…"). */
const CLASSROOM_FLASHCARD_ID = '00000000-0000-4000-8005-000000000008';

interface TeacherStats {
  summary: {
    totalFlashcards: number;
    practicingStudents: number;
    rosterStudents: number | null;
  };
}

async function login(page: Page, email: string, redirectPattern: RegExp) {
  await page.goto('/login');
  await page.getByLabel(t('LoginPage.email_label')).fill(email);
  await page.getByLabel(t('LoginPage.password_label')).fill(PASSWORD);
  await page.getByRole('button', { name: t('LoginPage.login_button') }).click();
  await page.waitForURL(redirectPattern);
}

async function fetchStats(page: Page): Promise<TeacherStats> {
  const body = await page.evaluate(async () => {
    const res = await fetch('/api/v1/flashcards/stats/teacher');
    return res.json();
  });
  return (body.data ?? body) as TeacherStats;
}

async function practice(page: Page, flashcardId: string) {
  const result = await page.evaluate(async (id) => {
    const res = await fetch(`/api/v1/flashcards/${id}/practice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wasCorrect: true }),
    });
    return { status: res.status, body: await res.json() };
  }, flashcardId);
  expect(result.status, JSON.stringify(result.body)).toBe(201);
}

/** The `StatCard` whose title contains the given regex. */
function statCard(page: Page, title: RegExp) {
  return page
    .locator('div.bg-card', { has: page.locator('p.uppercase', { hasText: title }) })
    .first();
}

test.describe('EDU stats — roster and practising counts (#460)', () => {
  test('renders the roster card, tracks a student practice and ignores the teacher', async ({
    browser,
  }) => {
    const teacherCtx = await browser.newContext();
    const teacher = await teacherCtx.newPage();
    await login(teacher, TEACHER_EMAIL, /\/edu/);

    const baseline = await fetchStats(teacher);
    expect(baseline.summary.rosterStudents).not.toBeNull();
    const baselineRoster = baseline.summary.rosterStudents as number;

    // 1. /edu/stats/data: value is the roster, description is the practiser count.
    await teacher.goto('/edu/stats/data');
    await teacher.waitForLoadState('networkidle');
    const rosterCard = statCard(teacher, t('StatsDataPage.students'));
    await expect(rosterCard).toBeVisible();
    await expect(rosterCard.locator('p.text-3xl')).toHaveText(String(baselineRoster));
    await expect(rosterCard.getByText(/Aktywnych: \d+|Active: \d+/)).toBeVisible();

    // 2. A student practises one Classroom card → practising +1, roster unchanged.
    const studentCtx = await browser.newContext();
    const student = await studentCtx.newPage();
    await login(student, STUDENT_EMAIL, /\/app/);
    await practice(student, CLASSROOM_FLASHCARD_ID);
    await studentCtx.close();

    await teacher.reload();
    await teacher.waitForLoadState('networkidle');
    const afterStudent = await fetchStats(teacher);
    expect(afterStudent.summary.practicingStudents).toBe(baseline.summary.practicingStudents + 1);
    expect(afterStudent.summary.rosterStudents).toBe(baselineRoster);

    const rosterCardAfter = statCard(teacher, t('StatsDataPage.students'));
    await expect(rosterCardAfter.locator('p.text-3xl')).toHaveText(String(baselineRoster));
    await expect(
      rosterCardAfter.getByText(
        new RegExp(
          `Aktywnych: ${afterStudent.summary.practicingStudents}|Active: ${afterStudent.summary.practicingStudents}`,
        ),
      ),
    ).toBeVisible();
    if (baselineRoster > 0) {
      const width = await rosterCardAfter
        .locator('div[style*="width"]')
        .first()
        .evaluate((el) => (el as HTMLElement).style.width);
      expect(parseFloat(width)).toBeGreaterThan(0);
    }

    // 3. The teacher practising their own deck does not count as a student.
    const beforeOwnPractice = (await fetchStats(teacher)).summary.practicingStudents;
    await practice(teacher, CLASSROOM_FLASHCARD_ID);
    await teacher.reload();
    await teacher.waitForLoadState('networkidle');
    const afterOwnPractice = await fetchStats(teacher);
    expect(afterOwnPractice.summary.practicingStudents).toBe(beforeOwnPractice);
    await expect(statCard(teacher, t('StatsDataPage.students')).locator('p.text-3xl')).toHaveText(
      String(baselineRoster),
    );

    // 4. /edu/flashcards/stats: renamed label, still six cards in one row.
    await teacher.goto('/edu/flashcards/stats');
    await teacher.waitForLoadState('networkidle');
    const statsGrid = teacher.locator('div[class*="xl:grid-cols-6"]');
    const titles = statsGrid.locator('p.uppercase');
    await expect(titles).toHaveCount(6);
    await expect(
      statsGrid.locator('p.uppercase', { hasText: t('EduFlashcardStatsPage.summary_students') }),
    ).toHaveCount(1);
    const tops = await titles.evaluateAll((els) =>
      els.map((el) => Math.round(el.getBoundingClientRect().top)),
    );
    expect(new Set(tops).size).toBe(1);

    await teacherCtx.close();
  });
});
