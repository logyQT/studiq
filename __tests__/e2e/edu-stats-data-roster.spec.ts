import type { Page } from '@playwright/test';
import { t } from '#test/e2e/utils';
import { expect, signIn, test } from '#test/e2e/fixtures/tenant';

/**
 * E2E coverage for #460 (EDU-ST-01).
 *
 * `/edu/stats/data` used to render "Wszyscy uczniowie" = distinct practisers,
 * so an org with enrolled students and no practices showed a bare 0. The card
 * now shows the group roster as its value and the practising count as
 * "Aktywnych: N", and a teacher practising their own deck no longer moves
 * either number.
 *
 * Runs on its own tenant: the org has one group, one student and no practice
 * state, so the deltas are exact instead of depending on what an earlier run
 * did to the shared dev seed.
 */

interface TeacherStats {
  summary: {
    totalFlashcards: number;
    practicingStudents: number;
    rosterStudents: number | null;
  };
}

async function fetchStats(page: Page): Promise<TeacherStats> {
  const res = await page.request.get('/api/v1/flashcards/stats/teacher');
  const body = await res.json();
  return (body.data ?? body) as TeacherStats;
}

async function practice(page: Page, flashcardId: string) {
  const res = await page.request.post(`/api/v1/flashcards/${flashcardId}/practice`, {
    data: { wasCorrect: true },
  });
  expect(res.status(), await res.text()).toBe(201);
}

/** The `StatCard` whose title contains the given regex. */
function statCard(page: Page, title: RegExp) {
  return page
    .locator('div.bg-card', { has: page.locator('p.uppercase', { hasText: title }) })
    .first();
}

test('renders the roster card, tracks a student practice and ignores the teacher', async ({
  page,
  tenant,
  browser,
}) => {
  await signIn(page, 'teacher');

  const baseline = await fetchStats(page);
  expect(baseline.summary.rosterStudents).not.toBeNull();
  const baselineRoster = baseline.summary.rosterStudents as number;
  expect(baselineRoster).toBeGreaterThan(0);

  // 1. /edu/stats/data: value is the roster, description is the practiser count.
  await page.goto('/edu/stats/data');
  await page.waitForLoadState('networkidle');
  const rosterCard = statCard(page, t('StatsDataPage.students'));
  await expect(rosterCard).toBeVisible();
  await expect(rosterCard.locator('p.text-3xl')).toHaveText(String(baselineRoster));
  await expect(rosterCard.getByText(/Aktywnych: \d+|Active: \d+/)).toBeVisible();

  // 2. The tenant's student practises one of the group's cards → practising +1.
  const studentCtx = await browser.newContext();
  const student = await studentCtx.newPage();
  await signIn(student, 'student');
  await practice(student, tenant.ids.card);
  await studentCtx.close();

  await page.reload();
  await page.waitForLoadState('networkidle');
  const afterStudent = await fetchStats(page);
  expect(afterStudent.summary.practicingStudents).toBe(baseline.summary.practicingStudents + 1);
  expect(afterStudent.summary.rosterStudents).toBe(baselineRoster);

  const rosterCardAfter = statCard(page, t('StatsDataPage.students'));
  await expect(rosterCardAfter.locator('p.text-3xl')).toHaveText(String(baselineRoster));
  await expect(
    rosterCardAfter.getByText(
      new RegExp(
        `Aktywnych: ${afterStudent.summary.practicingStudents}|Active: ${afterStudent.summary.practicingStudents}`,
      ),
    ),
  ).toBeVisible();

  // 3. The teacher practising their own card must not move either number.
  await practice(page, tenant.ids.card);

  await page.reload();
  await page.waitForLoadState('networkidle');
  const afterTeacher = await fetchStats(page);
  expect(afterTeacher.summary.practicingStudents).toBe(afterStudent.summary.practicingStudents);
  expect(afterTeacher.summary.rosterStudents).toBe(baselineRoster);
});
