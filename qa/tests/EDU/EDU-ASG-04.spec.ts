import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * EDU-ASG-04 — publishing a quiz to an audience (`/edu/assignments/:id`).
 *
 * Prerequisite (reconciled with the tenant seeder): a draft with questions, owned
 * by the teacher, and a group that holds the student (the case's „Classroom
 * Group” / `SC`). The legacy accounts (`teacher-classroom@dev.local`,
 * `student-classroom@dev.local`, password `pass`) are never used.
 *
 *   bun scripts/qa-tenant.ts EDU-ASG-04 --fresh
 *
 * Tenant: the case's own `content` tenant (`qa/tests/profiles/EDU-ASG-04.json`) —
 * organization `qa-edu-asg-04-<suffix>`, a manager, the teacher and the student,
 * plus the default group `G1`. All ids derive from
 * `tenantKey('qa/cases/EDU-ASG-04.md', 'EDU-ASG-04#<suffix>', 'qa-shared')`; the
 * spec owns its drafts, questions and targets, so nothing global (admin setting,
 * feature flag, plan, platform stat, singleton row) and no other tenant is
 * touched. Re-running against the same tenant stays green: titles carry a
 * per-execution tag and the assertions address those drafts only.
 *
 * Acceptance points (walked on the shared app, Polish UI):
 * 1. A draft's publication panel (card „Opublikuj”) shows the group picker
 *    „Wybierz grupy…”, the student picker „Szukaj uczniów…”, the „Termin” field
 *    and the hint „Wybierz co najmniej jedną grupę lub ucznia, aby opublikować”;
 *    with no audience the button „Opublikuj” is disabled.
 * 2. Picking the tenant group („Classroom Group” in the legacy seed) clears the
 *    hint, enables „Opublikuj”, and publishing with a „Termin” flips the header
 *    badge to „Opublikowane” (the panel is replaced by „Cofnij publikację” /
 *    „Wyniki”) and stores the deadline.
 * 3. Picking a single student through „Szukaj uczniów…” does the same.
 * 4. The student sees both published quizzes in `/app/assignments`
 *    („OCZEKUJĄCE”) and may open each one (STU-34).
 */

const CASE = 'EDU-ASG-04';

/** Polish copy the case quotes, as rendered by the current product. */
const COPY = {
  draft: 'Szkic',
  published: 'Opublikowane',
  publish: 'Opublikuj',
  publishing: 'Publikowanie...',
  publishCard: 'Opublikuj',
  groupsLabel: 'Grupy',
  groupPicker: 'Wybierz grupy...',
  studentsLabel: 'Uczniowie',
  studentPicker: 'Szukaj uczniów...',
  deadline: 'Termin',
  noTargets: 'Wybierz co najmniej jedną grupę lub ucznia, aby opublikować',
  unpublish: 'Cofnij publikację',
  results: 'Wyniki',
} as const;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface AssignmentDetail {
  id: string;
  title: string;
  status: 'draft' | 'published';
  deadline: string | null;
  question_count: number;
}

interface OrgMember {
  id: string;
  email: string;
  full_name: string | null;
}

/** `YYYY-MM-DDTHH:mm` for a `datetime-local` input, in the runner's timezone. */
function localDateTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

async function postJson<T>(
  page: Page,
  url: string,
  data: unknown,
): Promise<{ status: number; body: ApiEnvelope<T> }> {
  const response = await page.request.post(url, { data });
  const body = (await response.json()) as ApiEnvelope<T>;
  return { status: response.status(), body };
}

async function getData<T>(page: Page, url: string): Promise<T> {
  const response = await page.request.get(url);
  expect(response.ok(), `GET ${url} → ${response.status()} ${await response.text()}`).toBe(true);
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(body.success, `GET ${url} success flag`).toBe(true);
  return body.data;
}

/** The publication panel — the card whose title is „Opublikuj”. */
function publishCard(page: Page): Locator {
  return page.locator('main [data-slot="card"]').filter({
    has: page.locator('[data-slot="card-title"]').filter({ hasText: COPY.publishCard }),
  });
}

/** The header badge next to the assignment title. */
function statusBadge(page: Page, text: string): Locator {
  return page.locator('main').getByText(text, { exact: true });
}

/** A question bank of this tenant, created once and reused by later runs. */
async function ensureBank(page: Page, runTag: string): Promise<string> {
  const banks = await getData<{ items: { id: string }[] }>(
    page,
    '/api/v1/questions/banks?limit=100',
  );
  const existing = banks.items?.[0]?.id;
  if (existing) return existing;

  const created = await postJson<{ id: string }>(page, '/api/v1/questions/banks', {
    name: `EDU-ASG-04 bank ${runTag}`,
  });
  expect(created.status, 'POST /api/v1/questions/banks').toBe(201);
  return created.body.data.id;
}

async function createQuestion(page: Page, bankId: string, content: string): Promise<string> {
  const created = await postJson<{ id: string }>(page, '/api/v1/questions', {
    bankId,
    type: 'mcq',
    content,
    answers: [
      { content: 'Odpowiedź A', isCorrect: true, orderIndex: 0 },
      { content: 'Odpowiedź B', isCorrect: false, orderIndex: 1 },
    ],
  });
  expect(created.status, `POST /api/v1/questions (${content})`).toBe(201);
  return created.body.data.id;
}

/** The case's „szkic z pytaniami”: a draft owned by the teacher, with questions. */
async function createDraft(
  page: Page,
  title: string,
  questionIds: string[],
): Promise<AssignmentDetail> {
  const created = await postJson<AssignmentDetail>(page, '/api/v1/teacher/assignments', {
    title,
    shuffleQuestions: false,
    shuffleAnswers: false,
  });
  expect(created.status, `POST /api/v1/teacher/assignments (${title})`).toBe(201);

  const id = created.body.data.id;
  const added = await postJson<{ added: number }>(
    page,
    `/api/v1/teacher/assignments/${id}/questions`,
    { questionIds },
  );
  expect(added.status, `POST /api/v1/teacher/assignments/${id}/questions`).toBe(200);
  expect(added.body.data.added, 'the draft holds its questions').toBe(questionIds.length);

  const detail = await getData<AssignmentDetail>(page, `/api/v1/teacher/assignments/${id}`);
  expect(detail.status, 'the prerequisite is a draft').toBe('draft');
  expect(detail.question_count, 'the draft has questions').toBe(questionIds.length);
  return detail;
}

/** The picker options rendered in the MultiSelect popover, in order. */
async function pickTarget(page: Page, card: Locator, pickerIndex: number, label: string) {
  const picker = card.getByRole('combobox').nth(pickerIndex);
  await picker.click();

  const option = page.getByRole('option', { name: label, exact: true });
  await expect(option, `„${label}” is offered by the picker`).toBeVisible();

  // The panel debounces the target save by 500 ms; publishing before it lands
  // would answer 400 (the server refuses a publish without targets). Wait for the
  // save the selection triggers, exactly like a teacher who pauses before
  // clicking „Opublikuj”.
  const saved = page.waitForResponse(
    (response) =>
      /\/api\/v1\/teacher\/assignments\/[^/]+\/targets$/.test(new URL(response.url()).pathname) &&
      response.request().method() === 'PUT',
  );
  await option.click();
  const saveResponse = await saved;
  expect(saveResponse.status(), 'PUT the selected audience').toBe(200);

  // The multi-select keeps its popover open after a pick; Escape closes it.
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-slot="popover-content"]')).toHaveCount(0);
}

/** Fill the publication panel's „Termin” field. */
async function setDeadline(card: Locator, value: string): Promise<void> {
  const deadline = card.locator('input[type="datetime-local"]');
  await deadline.fill(value);
  await expect(deadline).toHaveValue(value);
}

/** Publish through the panel button and wait for the API to accept it. */
async function publish(card: Locator, assignmentId: string, page: Page): Promise<void> {
  const button = card.getByRole('button', { name: COPY.publish, exact: true });
  await expect(button).toBeEnabled();

  const published = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/v1/teacher/assignments/${assignmentId}/publish` &&
      response.request().method() === 'POST',
  );
  // `handlePublish` publishes first and then re-saves the targets; wait for that
  // second save too, so the student context never reads the delete/insert gap.
  const resaved = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/v1/teacher/assignments/${assignmentId}/targets` &&
      response.request().method() === 'PUT',
  );

  await button.click();
  expect((await published).status(), 'POST publish').toBe(200);
  expect((await resaved).status(), 'PUT targets after publish').toBe(200);
}

test.describe('@case:EDU-ASG-04 @area:EDU @prio:P1 assignment publishing', () => {
  test('a draft cannot be published without an audience and becomes visible to the student once published', async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(180_000);
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const tenant: QaTenant = loadTenant(CASE);
    const teacher = tenant.users.teacher;
    const student = tenant.users.student;
    expect(teacher, 'the tenant seeds the teacher').toBeTruthy();
    expect(student, 'the tenant seeds the student').toBeTruthy();
    expect(tenant.group?.name, 'the tenant has the group the case targets').toBeTruthy();

    // A per-execution tag keeps repeated runs against the same tenant apart.
    const runTag = `${tenant.runSuffix ?? 'stable'}-${Date.now().toString(36)}`;
    const groupTitle = `EDU-ASG-04 grupa ${runTag}`;
    const studentTitle = `EDU-ASG-04 uczeń ${runTag}`;
    const deadlineLocal = localDateTime(new Date(Date.now() + 3 * 24 * 60 * 60 * 1000));

    // ── Teacher: the prerequisite drafts with questions ─────────────────────
    await loginAs(page, tenant, 'teacher', { locale: 'pl', waitFor: /\/edu/ });
    expect(new URL(page.url()).pathname, 'the educator lands on /edu').toBe('/edu');

    const bankId = await ensureBank(page, runTag);
    const firstQuestion = await createQuestion(page, bankId, `EDU-ASG-04 pytanie A ${runTag}`);
    const secondQuestion = await createQuestion(page, bankId, `EDU-ASG-04 pytanie B ${runTag}`);
    const groupDraft = await createDraft(page, groupTitle, [firstQuestion, secondQuestion]);
    const studentDraft = await createDraft(page, studentTitle, [firstQuestion]);

    // ── Step 1: no audience → disabled button and the stated hint ───────────
    await page.goto(`/edu/assignments/${groupDraft.id}`);
    await expect(page).toHaveURL(new RegExp(`/edu/assignments/${groupDraft.id}$`));
    await expect(page.getByRole('heading', { name: groupTitle, exact: true })).toBeVisible();
    await expect(statusBadge(page, COPY.draft), 'the prerequisite is a draft').toBeVisible();

    const panel = publishCard(page);
    await expect(panel).toBeVisible();
    await expect(panel.getByText(COPY.groupsLabel, { exact: true })).toBeVisible();
    await expect(panel.getByText(COPY.studentsLabel, { exact: true })).toBeVisible();
    await expect(panel.getByRole('combobox').nth(0), 'the group picker placeholder').toContainText(
      COPY.groupPicker,
    );
    await expect(
      panel.getByRole('combobox').nth(1),
      'the student picker placeholder',
    ).toContainText(COPY.studentPicker);
    await expect(panel.getByText(COPY.noTargets, { exact: true })).toBeVisible();
    await expect(
      panel.getByRole('button', { name: COPY.publish, exact: true }),
      '„Opublikuj” stays inactive while no audience is selected',
    ).toBeDisabled();

    // ── Step 2a: pick the group ─────────────────────────────────────────────
    await pickTarget(page, panel, 0, tenant.group!.name);
    await expect(panel.getByRole('combobox').nth(0)).toContainText(tenant.group!.name);
    await expect(
      panel.getByText(COPY.noTargets, { exact: true }),
      'the hint disappears once an audience is selected',
    ).toHaveCount(0);
    await expect(panel.getByRole('button', { name: COPY.publish, exact: true })).toBeEnabled();

    // ── Step 3: set the deadline and publish ────────────────────────────────
    await setDeadline(panel, deadlineLocal);
    await publish(panel, groupDraft.id, page);

    await expect(statusBadge(page, COPY.published), 'header badge').toBeVisible();
    await expect(statusBadge(page, COPY.draft)).toHaveCount(0);
    await expect(publishCard(page), 'the publication panel is gone once published').toHaveCount(0);
    await expect(page.getByRole('button', { name: COPY.unpublish })).toBeVisible();
    await expect(
      page.locator('main').getByRole('link', { name: COPY.results, exact: true }),
      'the published panel offers the results view',
    ).toBeVisible();

    const groupPublished = await getData<AssignmentDetail>(
      page,
      `/api/v1/teacher/assignments/${groupDraft.id}`,
    );
    expect(groupPublished.status, 'stored status').toBe('published');
    expect(new Date(groupPublished.deadline!).toISOString(), 'stored deadline').toBe(
      new Date(deadlineLocal).toISOString(),
    );

    // ── Step 2b: the same flow for a single student target ──────────────────
    // The picker labels members by profile name; resolve the seeded student's own
    // label instead of hard-coding it.
    const members = await getData<OrgMember[]>(page, '/api/v1/organization/members?role=member');
    const studentMember = members.find((member) => member.email === student!.email);
    expect(studentMember, 'the tenant student is an org member').toBeTruthy();
    const studentLabel = studentMember!.full_name ?? studentMember!.email;

    await page.goto(`/edu/assignments/${studentDraft.id}`);
    await expect(page.getByRole('heading', { name: studentTitle, exact: true })).toBeVisible();
    const studentPanel = publishCard(page);
    await expect(studentPanel.getByText(COPY.noTargets, { exact: true })).toBeVisible();
    await expect(
      studentPanel.getByRole('button', { name: COPY.publish, exact: true }),
    ).toBeDisabled();

    await pickTarget(page, studentPanel, 1, studentLabel);
    await expect(studentPanel.getByRole('combobox').nth(1)).toContainText(studentLabel);
    await expect(studentPanel.getByText(COPY.noTargets, { exact: true })).toHaveCount(0);

    await setDeadline(studentPanel, localDateTime(new Date(Date.now() + 4 * 24 * 60 * 60 * 1000)));
    await publish(studentPanel, studentDraft.id, page);
    await expect(statusBadge(page, COPY.published)).toBeVisible();
    await expect(publishCard(page)).toHaveCount(0);

    const studentPublished = await getData<AssignmentDetail>(
      page,
      `/api/v1/teacher/assignments/${studentDraft.id}`,
    );
    expect(studentPublished.status, 'stored status').toBe('published');

    // ── Step 4: the student (SC) sees both published quizzes ────────────────
    const studentContext = await browser.newContext({ baseURL });
    try {
      const studentPage = await studentContext.newPage();
      const studentErrors: string[] = [];
      studentPage.on('pageerror', (error) => studentErrors.push(error.message));

      await loginAs(studentPage, tenant, 'student', { locale: 'pl', waitFor: /\/app/ });
      expect(new URL(studentPage.url()).pathname, 'the student lands on /app').toBe('/app');

      const assigned = await getData<{ id: string; title: string }[]>(
        studentPage,
        '/api/v1/assignments',
      );
      const assignedIds = assigned.map((assignment) => assignment.id);
      expect(assignedIds, 'the group-targeted quiz reaches the student').toContain(groupDraft.id);
      expect(assignedIds, 'the student-targeted quiz reaches the student').toContain(
        studentDraft.id,
      );

      const response = await studentPage.goto('/app/assignments');
      expect(response?.status(), 'GET /app/assignments').toBe(200);
      await expect(
        studentPage.getByRole('heading', { name: groupTitle, exact: true }),
        'the group-targeted quiz is listed for the student',
      ).toBeVisible();
      await expect(
        studentPage.getByRole('heading', { name: studentTitle, exact: true }),
        'the student-targeted quiz is listed for the student',
      ).toBeVisible();

      for (const id of [groupDraft.id, studentDraft.id]) {
        const detail = await studentPage.request.get(`/api/v1/assignments/${id}`);
        expect(detail.status(), `GET /api/v1/assignments/${id} as the student`).toBe(200);
      }

      expect(studentErrors, 'uncaught page errors in the student session').toEqual([]);
    } finally {
      await studentContext.close();
    }

    expect(pageErrors, 'uncaught page errors in the teacher session').toEqual([]);
  });
});
