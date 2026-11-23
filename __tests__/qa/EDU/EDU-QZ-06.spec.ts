import { expect, test, type Page } from '@playwright/test';
import { json } from '#test/helpers/json';
import { loadTenant, loginAs, tenantUser } from '#test/qa/fixtures/tenant';

/**
 * EDU-QZ-06 — the saved-quiz library is gated on `quiz.templates` (ADR-0015 §7,
 * phase 5d): a teacher whose org is on the free `launch` plan (personal `lite`)
 * gets the plan card instead of the list/form and a 403 on every library write,
 * while the one-off assignment path and the quiz reads stay open.
 *
 * Case: `qa/cases/EDU-QZ-06.md`.
 *
 * Tenant (deterministic `content` profile, free `launch` org — the DB default,
 * no `--plan` override; one fresh run suffix per independent run):
 *
 *   bun scripts/qa-tenant.ts EDU-QZ-06 --fresh
 *
 * gives the org `qa-edu-qz-06-<suffix>` with a manager, an educator and a student,
 * plus the default group `G1`; the spec logs in as `tenant.users.teacher`. Nothing
 * shared is read or written: no admin setting, feature flag, plan, platform stat
 * or singleton row, and no other tenant. The bank/question/assignment of the
 * one-off path are created through the product API inside this tenant.
 *
 * Acceptance points:
 * 1. `GET /api/v1/features/me` as the teacher does not contain `quiz.templates`
 *    (the 403s below are the entitlement gate, not a persona rule).
 * 2. `/edu/quizzes` keeps the „Quizy” heading, shows the plan card
 *    („Biblioteka testów” + „Zobacz plany”) and has no „Nowy quiz” button.
 * 3. `POST /api/v1/teacher/quizzes {"name":"…"}` → 403 `FORBIDDEN`, also with an
 *    invalid body (the gate is the first statement, before the parse).
 * 4. `/edu/quizzes/new` shows the plan card instead of the form.
 * 5. The one-off path still works: `POST /api/v1/teacher/assignments` → 201, add
 *    one question → 200, set the tenant group as target → 200, publish → 200.
 * 6. `GET /api/v1/teacher/quizzes` → 200 (the read stays open; an empty list is
 *    fine — this tenant owns no quiz, the write was refused).
 * 7. The `/edu` landing fires no gated read: both dashboard cards ("Wyniki grup",
 *    "Ostatnia aktywność") show the plan card, and no request to
 *    `/api/v1/stats/teacher/groups` or `/api/v1/stats/teacher/feed` answers 4xx
 *    during the load (the `stats.insights` gate disables the queries, so the
 *    collector below stays empty).
 *
 * Mutation (proves this spec can fail): delete the
 * `await requireEntitlement(ctx, 'quiz.templates')` line from
 * `QuizTeacherController.create` — step 3 then answers 201 (the permission check
 * passes on the seeded Teacher role), so the spec goes red. Deleting `canInsights`
 * from the `/edu` dashboard's `enabled` conditions fires the two gated reads →
 * 403 → step 7's collector goes red.
 */

const CASE = 'EDU-QZ-06';

const QUIZZES_URL = '/api/v1/teacher/quizzes';

/** Polish copy from `EduQuizzesPage` / `EduQuizNewPage` / `EduOverviewPage` (pl.json). */
const COPY = {
  listTitle: 'Quizy',
  newQuiz: 'Nowy quiz',
  lockedTitle: 'Biblioteka testów',
  lockedCta: 'Zobacz plany',
  newTitle: 'Nowy quiz',
  insightsLockedTitle: 'Analizy i słabe punkty',
} as const;

/** The two `stats.insights`-gated dashboard reads, by URL fragment. */
const GATED_DASHBOARD_READS = ['/api/v1/stats/teacher/groups', '/api/v1/stats/teacher/feed'];

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error?: string;
}

async function getData<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  const body = await json<ApiEnvelope<T>>(response);
  expect(body.success, `GET ${url} success flag`).toBe(true);
  return body.data;
}

async function postJson<T>(
  page: Page,
  url: string,
  data: unknown,
): Promise<{ status: number; errorCode: string | null; body: ApiEnvelope<T> }> {
  const response = await page.request.post(url, { data });
  return {
    status: response.status(),
    errorCode: response.headers()['x-error-code'] ?? null,
    body: await json<ApiEnvelope<T>>(response),
  };
}

test.describe('@case:EDU-QZ-06 @area:EDU @prio:P2 free teacher gets the plan card, not the quiz library', () => {
  test('the quiz library is locked and the one-off assignment path still works', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const tenant = loadTenant(CASE);
    expect(tenant.profile, `${CASE} needs the content tenant profile`).toBe('content');
    if (!tenant.org || !tenant.group) {
      throw new Error(`${CASE} needs the content tenant profile (org and default group)`);
    }
    const teacher = tenantUser(tenant, 'teacher');

    // Evidence for a failing run: the deterministic tenant this run owns.
    console.log(`EDU-QZ-06 tenant key: ${tenant.key} (teacher ${teacher.email})`);

    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // 4xx collector for the gated dashboard reads, attached before the login
    // landing (which already loads /edu) and asserted in step 6: while
    // unentitled the queries are disabled, so nothing may answer 4xx.
    const gatedReads4xx: string[] = [];
    page.on('response', (response) => {
      if (
        GATED_DASHBOARD_READS.some((fragment) => response.url().includes(fragment)) &&
        response.status() >= 400
      ) {
        gatedReads4xx.push(`${response.status()} ${response.url()}`);
      }
    });

    await loginAs(page, tenant, 'teacher', { locale: 'pl', waitFor: /\/edu(\/|$)/ });

    // --- Precondition: the entitlement, not the persona, is the reason ------
    const features = await getData<{ features: string[] }>(page, '/api/v1/features/me');
    expect(
      features.features,
      'launch org + lite personal plan resolve no quiz.templates',
    ).not.toContain('quiz.templates');

    // --- Step 1: the list shows the plan card, no "Nowy quiz" ----------------
    await page.goto('/edu/quizzes');
    await expect(page).toHaveURL(/\/edu\/quizzes$/);
    await expect(page.getByRole('heading', { name: COPY.listTitle, exact: true })).toBeVisible();
    await expect(page.getByText(COPY.lockedTitle, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: COPY.lockedCta, exact: true })).toBeVisible();
    await expect(
      page.getByRole('link', { name: COPY.newQuiz, exact: true }),
      'no "Nowy quiz" control while unentitled',
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: COPY.newQuiz, exact: true }),
      'no "Nowy quiz" button either',
    ).toHaveCount(0);

    // --- Step 2: the library write is refused before the validation ----------
    const valid = await postJson<unknown>(page, QUIZZES_URL, { name: 'EDU-QZ-06 quiz' });
    expect(
      valid.status,
      `POST ${QUIZZES_URL} with a valid body → ${JSON.stringify(valid.body)}`,
    ).toBe(403);
    expect(valid.errorCode, 'x-error-code header').toBe('FORBIDDEN');
    expect(valid.body).toEqual({ success: false, error: 'FORBIDDEN' });

    const invalid = await postJson<unknown>(page, QUIZZES_URL, {});
    expect(invalid.status, 'POST with an invalid body is still 403, not 422').toBe(403);
    expect(invalid.errorCode).toBe('FORBIDDEN');

    // --- Step 3: the new-quiz page shows the plan card instead of the form ----
    await page.goto('/edu/quizzes/new');
    await expect(page).toHaveURL(/\/edu\/quizzes\/new$/);
    await expect(page.getByRole('heading', { name: COPY.newTitle, exact: true })).toBeVisible();
    await expect(page.getByText(COPY.lockedTitle, { exact: true })).toBeVisible();
    await expect(page.locator('#name'), 'no name field while unentitled').toHaveCount(0);

    // --- Step 4: the one-off assignment path still works ---------------------
    const runTag = tenant.runSuffix ?? tenant.key.slice(-8);
    const bank = await postJson<{ id: string }>(page, '/api/v1/questions/banks', {
      name: `EDU-QZ-06 bank ${runTag}`,
    });
    expect(bank.status, 'POST /api/v1/questions/banks (the one-off path needs a bank)').toBe(201);

    const question = await postJson<{ id: string }>(page, '/api/v1/questions', {
      bankId: bank.body.data.id,
      type: 'mcq',
      content: `EDU-QZ-06 pytanie ${runTag}`,
      // R16/R17: an mcq carries its authoring explanation (≥ 80 chars, naming no option), or the create is a 422.
      explanation:
        'Uzasadnienie EDU-QZ-06: wybór wynika z treści polecenia i kolejności przedstawionych informacji.',
      answers: [
        { content: 'Odpowiedź A', isCorrect: true, orderIndex: 0 },
        { content: 'Odpowiedź B', isCorrect: false, orderIndex: 1 },
      ],
    });
    expect(question.status, 'POST /api/v1/questions').toBe(201);
    const questionId = question.body.data.id;

    const assignment = await postJson<{ id: string }>(page, '/api/v1/teacher/assignments', {
      title: `EDU-QZ-06 kartkówka ${runTag}`,
      shuffleQuestions: false,
      shuffleAnswers: false,
    });
    expect(
      assignment.status,
      `POST /api/v1/teacher/assignments (no ?quizId — the free one-off path) → ${assignment.status}`,
    ).toBe(201);
    const assignmentId = assignment.body.data.id;

    const added = await postJson<{ added: number }>(
      page,
      `/api/v1/teacher/assignments/${assignmentId}/questions`,
      { questionIds: [questionId] },
    );
    expect(added.status, 'POST the assignment questions').toBe(200);
    expect(added.body.data.added, 'the one-off assignment holds its question').toBe(1);

    const targets = await page.request.put(`/api/v1/teacher/assignments/${assignmentId}/targets`, {
      data: { groupIds: [tenant.group.id] },
    });
    expect(targets.status(), 'PUT the assignment targets (the tenant group G1)').toBe(200);

    const published = await postJson<unknown>(
      page,
      `/api/v1/teacher/assignments/${assignmentId}/publish`,
      // A published run must be able to end: the close is a publish precondition (R2/R5).
      { deadline: new Date(Date.now() + 7 * 86_400_000).toISOString() },
    );
    expect(published.status, 'POST publish the one-off assignment').toBe(200);

    // --- Step 5: the quiz read stays open ------------------------------------
    const listResponse = await page.request.get(QUIZZES_URL);
    expect(listResponse.status(), `GET ${QUIZZES_URL} (read is free)`).toBe(200);
    const listBody = await json<ApiEnvelope<unknown[]>>(listResponse);
    expect(listBody.success).toBe(true);
    expect(listBody.data, 'the refused write created no quiz').toHaveLength(0);

    // --- Step 6: the /edu dashboard fires no gated read -----------------------
    await page.goto('/edu');
    await expect(page).toHaveURL(/\/edu\/?$/);
    // Both gated cards ("Wyniki grup", "Ostatnia aktywność") keep their headers and
    // show the plan card in place of the body — no error state, no dead control.
    await expect(
      page.getByText(COPY.insightsLockedTitle, { exact: true }),
      'the plan card in both dashboard cards',
    ).toHaveCount(2);
    await expect(
      page.getByRole('button', { name: COPY.lockedCta, exact: true }),
      'the pricing CTA in both dashboard cards',
    ).toHaveCount(2);
    expect(
      gatedReads4xx,
      'no 4xx from /api/v1/stats/teacher/groups|feed during the dashboard loads',
    ).toEqual([]);

    expect(pageErrors, 'no browser console errors during the walk').toEqual([]);
  });
});
