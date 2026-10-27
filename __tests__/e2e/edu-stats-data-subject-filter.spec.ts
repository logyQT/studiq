import { expect, type Locator, type Page, test } from '@playwright/test';
import { t } from '#test/e2e/utils';

/**
 * E2E coverage for #200 (EDU-ST-01, step 2).
 *
 * `/edu/stats/data` used to render a permanently empty "Pytania według typu"
 * card and no subject filter at all: the page read `stats.subject.byType` while
 * `GET /api/v1/stats/teacher` returned only totals. Both the filter (which only
 * narrows the type split) and the new "Pytania według przedmiotu" card are
 * asserted here, plus the error path: a non-2xx stats response must show an
 * inline alert and keep the last good payload instead of crashing the page.
 *
 * The suite runs `fullyParallel` against one seeded database, so every
 * expectation is derived from the API baseline (as `edu-stats-data-roster.spec.ts`
 * does).
 */

const PASSWORD = 'pass';
const TEACHER_EMAIL = 'teacher-classroom@dev.local';
const STATS_URL = '/api/v1/stats/teacher';

interface TeacherStatsPayload {
  totalQuestions: number;
  totalFlashcards: number;
  subject: { byType: Record<string, number> };
  bySubject: Array<{
    subjectId: string;
    subjectName: string | null;
    questionCount: number;
  }>;
}

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel(t('LoginPage.email_label')).fill(TEACHER_EMAIL);
  await page.getByLabel(t('LoginPage.password_label')).fill(PASSWORD);
  await page.getByRole('button', { name: t('LoginPage.login_button') }).click();
  await page.waitForURL(/\/edu/);
}

/** The type card row label, localized the same way the page localizes it. */
function typeLabel(key: string) {
  return ['mcq', 'true_false', 'open'].includes(key)
    ? t(`Common.question_type_${key}`)
    : new RegExp(key.replaceAll('_', ' '), 'i');
}

function subjectLabel(subject: TeacherStatsPayload['bySubject'][number]): string | RegExp {
  return subject.subjectName ?? t('StatsDataPage.unknown_subject');
}

function card(page: Page, title: RegExp) {
  return page.locator('[data-slot="card"]', { hasText: title }).first();
}

function cardRow(parent: Locator, label: string | RegExp) {
  return parent.locator('div.flex.items-center.justify-between', { hasText: label }).first();
}

/** The big number rendered by the `StatCard` with the given title. */
function statCardValue(page: Page, title: RegExp) {
  return page
    .locator('p.uppercase', { hasText: title })
    .first()
    .locator('xpath=following-sibling::p[1]');
}

async function expectTypeSplit(page: Page, byType: Record<string, number>) {
  const typeCard = card(page, t('StatsDataPage.by_type_title'));
  const entries = Object.entries(byType);

  if (entries.length === 0) {
    await expect(typeCard.getByText(t('StatsDataPage.no_questions'))).toBeVisible();
    return;
  }

  for (const [key, count] of entries) {
    await expect(cardRow(typeCard, typeLabel(key)).locator('span').last()).toHaveText(
      String(count),
    );
  }
  await expect(typeCard.locator('div.flex.items-center.justify-between')).toHaveCount(
    entries.length,
  );
}

async function pickSubject(page: Page, label: string | RegExp) {
  await page.getByRole('combobox', { name: t('StatsDataPage.filter_subject') }).click();
  await page.getByRole('option', { name: label }).first().click();
}

test.describe('EDU content stats — subject filter and breakdowns (#200)', () => {
  test('renders both breakdowns, filters the type split and survives a failed request', async ({
    page,
  }) => {
    await login(page);

    const response = await page.request.get(STATS_URL);
    expect(response.status()).toBe(200);
    const body = await response.json();
    const baseline = (body.data ?? body) as TeacherStatsPayload;
    expect(baseline.totalQuestions).toBeGreaterThan(0);
    expect(baseline.bySubject.length).toBeGreaterThan(0);
    expect(Object.keys(baseline.subject.byType).length).toBeGreaterThan(0);

    await page.goto('/edu/stats/data');

    // 1. The filter exists and starts on "all subjects" (scenario step 2).
    const filter = page.getByRole('combobox', { name: t('StatsDataPage.filter_subject') });
    await expect(filter).toBeVisible();
    await expect(filter).toContainText(t('StatsDataPage.all_subjects'));

    // 2. One option per subject row plus the "all subjects" sentinel.
    await filter.click();
    await expect(page.getByRole('option')).toHaveCount(baseline.bySubject.length + 1);
    for (const subject of baseline.bySubject) {
      await expect(page.getByRole('option', { name: subjectLabel(subject) }).first()).toBeVisible();
    }
    await page.keyboard.press('Escape');

    // 3. The type card matches the global split, and the by-subject card matches
    //    the global distribution.
    await expectTypeSplit(page, baseline.subject.byType);

    const subjectCard = card(page, t('StatsDataPage.by_subject_title'));
    for (const subject of baseline.bySubject) {
      await expect(cardRow(subjectCard, subjectLabel(subject)).locator('span').last()).toHaveText(
        String(subject.questionCount),
      );
    }

    // 4. Filter round-trip: the type card follows the filtered payload while the
    //    totals and the by-subject card stay global.
    const firstSubject = baseline.bySubject[0];
    const filteredResponse = await page.request.get(
      `${STATS_URL}?subjectId=${encodeURIComponent(firstSubject.subjectId)}`,
    );
    expect(filteredResponse.status()).toBe(200);
    const filteredBody = await filteredResponse.json();
    const filtered = (filteredBody.data ?? filteredBody) as TeacherStatsPayload;

    await pickSubject(page, subjectLabel(firstSubject));
    await expectTypeSplit(page, filtered.subject.byType);
    await expect(statCardValue(page, t('StatsDataPage.total_questions'))).toHaveText(
      String(baseline.totalQuestions),
    );
    await expect(
      cardRow(subjectCard, subjectLabel(baseline.bySubject[1] ?? firstSubject)),
    ).toBeVisible();

    await pickSubject(page, t('StatsDataPage.all_subjects'));
    await expectTypeSplit(page, baseline.subject.byType);

    // 5. Regression for the error path: a JSON 4xx/5xx envelope used to be stored
    //    in state and crash the render, replacing the page with app/error.tsx.
    const secondSubject = baseline.bySubject[1] ?? firstSubject;
    const secondResponse = await page.request.get(
      `${STATS_URL}?subjectId=${encodeURIComponent(secondSubject.subjectId)}`,
    );
    const secondBody = await secondResponse.json();
    const second = (secondBody.data ?? secondBody) as TeacherStatsPayload;

    await page.route(`**${STATS_URL}*`, (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' }),
      }),
    );

    await pickSubject(page, subjectLabel(secondSubject));

    // Next's route announcer also carries role="alert", so scope to the Alert component.
    const alert = page.locator('[data-slot="alert"]');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(t('StatsDataPage.load_error'));
    // The last good payload stays mounted instead of being replaced by the error.
    await expectTypeSplit(page, baseline.subject.byType);
    await expect(page.getByRole('heading', { name: /Oops! Something went wrong/i })).toHaveCount(0);

    // 6. Retry recovers without a reload.
    await page.unroute(`**${STATS_URL}*`);
    await page.getByRole('button', { name: t('StatsDataPage.retry') }).click();
    await expect(alert).toBeHidden();
    await expectTypeSplit(page, second.subject.byType);
  });
});
