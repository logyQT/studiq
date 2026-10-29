import { expect, test, type Locator, type Page } from '@playwright/test';
import { loadTenant, loginAs, type QaTenant } from '@qa/fixtures/qa-tenant';

/**
 * EDU-ST-02 — teacher statistics, „Wyniki” (`/edu/stats/results`).
 *
 * Prerequisite (reconciled with the tenant seeder): „Po kilku próbach quizów/fiszek
 * studenta SC” — a student of the teacher's organization who has completed a
 * couple of quiz attempts and practised the teacher's flashcards. The legacy
 * account (`student-classroom@dev.local`, password `pass`) is never used.
 *
 *   bun scripts/qa-tenant.ts EDU-ST-02 --fresh
 *
 * Tenant: the case's own `org-limit` tenant (`qa/tests/profiles/EDU-ST-02.json`) —
 * organization `qa-edu-st-02-<suffix>` with an admin, two educators (`teacher`,
 * `teacher2`) and one student, plus the default group `G1`. The shape is needed
 * for both branches of the case: `teacher` owns the content the spec creates,
 * and `teacher2` is an educator of the same organization who never creates any
 * content, so the „no problematic questions” state is reachable on every run
 * (including a retry against an already-used tenant).
 *
 * Every execution creates its own deck/cards/bank/questions/quiz/assignment
 * through the product API with a per-execution tag, and the student runs its
 * attempts and practices in a second browser context. Nothing global (admin
 * setting, feature flag, plan, platform stat, singleton row) and no other
 * tenant is touched, so `--repeat-each` against one seeded tenant is safe.
 *
 * Acceptance points (walked on the shared app, worker qa-env-7, Polish UI):
 * 1. Five cards: „Próby testów”, „Średni wynik testu”, „Łącznie ćwiczeń”,
 *    „Ogólna skuteczność”, „Śr. EF” — each showing the value the page's own
 *    endpoints report for this organization.
 * 2. „Rozkład trudności” chart with the four buckets, whose counts match the
 *    teacher flashcard stats and add up to the teacher's flashcard count.
 * 3. „Wyniki quizów” lists the quiz the student attempted, with its attempt
 *    count and rounded average score.
 * 4. „Problematyczne pytania” lists the question answered below 50 % with its
 *    correct rate, and leaves the correctly answered ones out.
 * 5. With no such question the card shows „Nie wykryto problematycznych pytań.
 *    Świetna robota!” instead.
 * 6. The three links („Zobacz wszystkie testy”, „Zobacz szczegóły fiszek”,
 *    „Zobacz szczegóły pytań”) open their own pages.
 */

const CASE = 'EDU-ST-02';
const RESULTS_PATH = '/edu/stats/results';

/** Polish copy the case quotes, as the current product renders it. */
const COPY = {
  title: 'Wyniki',
  description: 'Wyniki uczniów i ocena postępów',
  attempts: 'Próby testów',
  avgScore: 'Średni wynik testu',
  practices: 'Łącznie ćwiczeń',
  accuracy: 'Ogólna skuteczność',
  easiness: 'Śr. EF',
  difficulty: 'Rozkład trudności',
  buckets: ['Łatwy', 'Średni', 'Trudny', 'Nowy'],
  quizPerformance: 'Wyniki quizów',
  problematic: 'Problematyczne pytania',
  problematicDescription: 'Pytania z poprawnością poniżej 50%',
  noProblematic: 'Nie wykryto problematycznych pytań. Świetna robota!',
  correctSuffix: 'poprawnych',
  quizStatsLink: 'Zobacz wszystkie testy',
  flashcardStatsLink: 'Zobacz szczegóły fiszek',
  questionStatsLink: 'Zobacz szczegóły pytań',
} as const;

/** How many cards/attempts the spec creates for one execution. */
const CARDS = 4;
const ATTEMPTS = 2;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

interface QuizSummary {
  id: string;
  title: string | null;
  totalAttempts: number;
  avgScore: number;
}

interface DifficultyBreakdown {
  easy: number;
  medium: number;
  hard: number;
  new: number;
}

interface FlashcardStats {
  summary: {
    totalDecks: number;
    totalFlashcards: number;
    totalPractices: number;
    overallAccuracy: number;
    averageEasinessFactor: number;
    difficultyBreakdown: DifficultyBreakdown;
  };
}

interface ProblematicQuestion {
  id: string;
  content: string;
  type: string;
  correctRate: number;
}

interface TeacherStats {
  totalQuestions: number;
  totalFlashcards: number;
  subject: { byType: Record<string, number>; problematicQuestions: ProblematicQuestion[] };
}

interface StatsSnapshot {
  quizzes: QuizSummary[];
  flashcards: FlashcardStats;
  teacher: TeacherStats;
}

interface QuestionSeed {
  id: string;
  content: string;
  /** Id of the option the student picks to answer correctly. */
  correctOptionId: string;
  /** Id of the option the student picks to answer incorrectly. */
  wrongOptionId: string;
}

interface CaseContent {
  deckName: string;
  cardIds: string[];
  quizName: string;
  assignmentId: string;
  questions: QuestionSeed[];
}

/** One request against the product API, with the envelope unwrapped. */
async function api<T>(
  page: Page,
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  data?: unknown,
): Promise<T> {
  const response = await page.request.fetch(url, { method, data });
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(response.ok(), `${method} ${url} → ${response.status()} ${JSON.stringify(body)}`).toBe(
    true,
  );
  expect(body.success, `${method} ${url} success flag`).toBe(true);
  return body.data;
}

/** The three endpoints the page itself calls. */
async function readStats(page: Page): Promise<StatsSnapshot> {
  return {
    quizzes: await api<QuizSummary[]>(page, 'GET', '/api/v1/stats/teacher/quizzes'),
    flashcards: await api<FlashcardStats>(page, 'GET', '/api/v1/flashcards/stats/teacher'),
    teacher: await api<TeacherStats>(page, 'GET', '/api/v1/stats/teacher'),
  };
}

/**
 * The five card values, derived from the same endpoints the page reads: attempts
 * summed over the class's quizzes, the mean of the per-quiz averages, and the
 * teacher's own practice aggregates.
 */
function expectedCards(stats: StatsSnapshot): Record<string, string> {
  const { quizzes, flashcards } = stats;
  const attempts = quizzes.reduce((sum, quiz) => sum + quiz.totalAttempts, 0);
  const average =
    quizzes.length > 0
      ? Math.round(quizzes.reduce((sum, quiz) => sum + quiz.avgScore, 0) / quizzes.length)
      : null;
  return {
    [COPY.attempts]: String(attempts),
    [COPY.avgScore]: average === null ? '\u2014' : `${average}%`,
    [COPY.practices]: String(flashcards.summary.totalPractices),
    [COPY.accuracy]: `${flashcards.summary.overallAccuracy}%`,
    [COPY.easiness]: flashcards.summary.averageEasinessFactor.toFixed(2),
  };
}

/**
 * The case's prerequisite as the product builds it: one deck of four cards, one
 * bank of three questions and a quiz holding them, published as an assignment
 * for the tenant's student. Every title/content carries the execution tag so a
 * repeat run on the same tenant never edits a previous run's content.
 */
async function createContent(page: Page, tenant: QaTenant, tag: string): Promise<CaseContent> {
  const deckName = `${CASE} deck ${tag}`;
  const deck = await api<{ id: string }>(page, 'POST', '/api/v1/flashcards/decks', {
    name: deckName,
  });

  const cardIds: string[] = [];
  for (const label of ['A', 'B', 'C', 'D']) {
    const card = await api<{ id: string }>(page, 'POST', '/api/v1/flashcards', {
      deckId: deck.id,
      front: `${tag} karta ${label}`,
      back: `${tag} odpowiedź ${label}`,
    });
    cardIds.push(card.id);
  }

  const bank = await api<{ id: string }>(page, 'POST', '/api/v1/questions/banks', {
    name: `${CASE} bank ${tag}`,
  });

  const questions: QuestionSeed[] = [];
  for (const label of ['A', 'B', 'C']) {
    const content = `${CASE} ${tag} pytanie ${label}`;
    const question = await api<{
      id: string;
      question_answers: Array<{ id: string; is_correct: boolean }>;
    }>(page, 'POST', '/api/v1/questions', {
      bankId: bank.id,
      type: 'mcq',
      content,
      answers: [
        { content: 'tak', isCorrect: true, orderIndex: 0 },
        { content: 'nie', isCorrect: false, orderIndex: 1 },
      ],
    });
    const correct = question.question_answers.find((option) => option.is_correct);
    const wrong = question.question_answers.find((option) => !option.is_correct);
    if (!correct || !wrong) {
      throw new Error(`EDU-ST-02: question ${content} has no correct/incorrect option pair`);
    }
    questions.push({
      id: question.id,
      content,
      correctOptionId: correct.id,
      wrongOptionId: wrong.id,
    });
  }

  const quizName = `${CASE} quiz ${tag}`;
  const quiz = await api<{ id: string }>(page, 'POST', '/api/v1/teacher/quizzes', {
    name: quizName,
    description: 'wyniki',
  });
  await api<unknown>(page, 'POST', `/api/v1/teacher/quizzes/${quiz.id}/questions`, {
    questionIds: questions.map((question) => question.id),
  });

  // Two attempts per student so „Próby testów” and „Średni wynik testu” cover a
  // mean, and results stay visible to the student (the teacher page reads the
  // attempts either way).
  const assignment = await api<{ id: string }>(page, 'POST', '/api/v1/teacher/assignments', {
    title: quizName,
    quizId: quiz.id,
    showResults: true,
    maxAttempts: ATTEMPTS,
    shuffleQuestions: false,
    shuffleAnswers: false,
  });
  const student = tenant.users.student;
  if (!student) throw new Error(`EDU-ST-02: tenant ${tenant.key} has no seeded student`);
  await api<unknown>(page, 'PUT', `/api/v1/teacher/assignments/${assignment.id}/targets`, {
    studentIds: [student.id],
  });
  await api<unknown>(page, 'POST', `/api/v1/teacher/assignments/${assignment.id}/publish`, {});

  return { deckName, cardIds, quizName, assignmentId: assignment.id, questions };
}

/**
 * The student's side of the prerequisite: two completed attempts on the
 * assignment (two of three questions right, so the third stays below 50 %) and
 * four flashcard practices (three right, one wrong).
 */
async function runStudentActivity(
  page: Page,
  content: CaseContent,
  assignmentId: string,
): Promise<void> {
  const [first, second, third] = content.questions;
  const answers = [
    { questionId: first.id, selectedAnswerId: first.correctOptionId },
    { questionId: second.id, selectedAnswerId: second.correctOptionId },
    { questionId: third.id, selectedAnswerId: third.wrongOptionId },
  ];

  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const started = await api<{ id: string; questions: Array<{ id: string }> }>(
      page,
      'POST',
      `/api/v1/assignments/${assignmentId}/start`,
      {},
    );
    expect(
      started.questions.map((question) => question.id).sort(),
      'the attempt holds the quiz questions',
    ).toEqual(content.questions.map((question) => question.id).sort());
    const submitted = await api<{ score: number; totalQuestions: number }>(
      page,
      'POST',
      `/api/v1/quiz/${started.id}`,
      { answers },
    );
    expect(submitted.score, `attempt ${attempt + 1} score`).toBe(2);
    expect(submitted.totalQuestions, `attempt ${attempt + 1} question count`).toBe(3);
  }

  const practices = [
    { cardId: content.cardIds[0], wasCorrect: true, confidenceLevel: 5 },
    { cardId: content.cardIds[1], wasCorrect: true, confidenceLevel: 5 },
    { cardId: content.cardIds[2], wasCorrect: true, confidenceLevel: 4 },
    { cardId: content.cardIds[3], wasCorrect: false, confidenceLevel: 1 },
  ];
  for (const practice of practices) {
    await api<unknown>(page, 'POST', `/api/v1/flashcards/${practice.cardId}/practice`, {
      wasCorrect: practice.wasCorrect,
      confidenceLevel: practice.confidenceLevel,
    });
  }
}

/** Escape a literal so a title can be used as a `hasText` pattern. */
function literal(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A `StatCard`: the only `rounded-xl border` block on this page that is not a
 * `[data-slot="card"]`, matched by the title it renders (CSS upper-cases it).
 */
function statCard(page: Page, title: string): Locator {
  return page
    .locator('main div.rounded-xl.border:not([data-slot="card"])')
    .filter({ hasText: new RegExp(`^${literal(title)}`, 'i') });
}

/** The card value under a stat card's title. */
function statValue(page: Page, title: string): Locator {
  return statCard(page, title).locator('p').nth(1);
}

/** A named `Card` on the page (difficulty chart, quiz performance, problematic). */
function namedCard(page: Page, title: string): Locator {
  return page.locator('main [data-slot="card"]').filter({
    hasText: new RegExp(`^${literal(title)}`, 'i'),
  });
}

/** Rendered difficulty chart as `{ Łatwy: 3, Średni: 0, ... }`. */
async function readDifficulty(page: Page): Promise<Record<string, number>> {
  const rows = namedCard(page, COPY.difficulty).locator('div.flex.items-center.gap-3');
  const count = await rows.count();
  const out: Record<string, number> = {};
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    const label = (await row.locator('span').first().innerText()).trim();
    out[label] = Number((await row.locator('span').last().innerText()).trim());
  }
  return out;
}

/** The question rows inside „Problematyczne pytania”. */
function problematicRows(page: Page): Locator {
  return namedCard(page, COPY.problematic).locator('div.rounded-lg.border');
}

test.describe('@case:EDU-ST-02 @area:EDU @prio:P2 teacher results statistics', () => {
  test('shows the result cards, difficulty chart, quiz results, problematic questions and links', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);

    const pageErrors: string[] = [];
    const failedRequests: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('response', (response) => {
      if (response.status() >= 400 && response.url().includes('/api/v1/')) {
        failedRequests.push(`${response.status()} ${new URL(response.url()).pathname}`);
      }
    });

    const tenant = loadTenant(CASE);
    expect(tenant.users.teacher, 'the tenant seeds the teacher').toBeTruthy();
    expect(tenant.users.student, 'the tenant seeds the student').toBeTruthy();

    // Every execution builds its own content, so a retry on the same tenant only
    // adds a new quiz/question row and never edits a previous run's data.
    const tag = `${tenant.runSuffix ?? 'stable'}-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 6)}`;

    await loginAs(page, tenant, 'teacher', { locale: 'pl', waitFor: /\/edu/ });
    expect(new URL(page.url()).pathname, 'the educator lands on /edu').toBe('/edu');

    const before = await readStats(page);

    const content = await createContent(page, tenant, tag);

    const baseURL = test.info().project.use.baseURL as string;
    const studentContext = await browser.newContext({ baseURL });
    try {
      const studentPage = await studentContext.newPage();
      await loginAs(studentPage, tenant, 'student', { locale: 'pl', waitFor: /\/app/ });
      await runStudentActivity(studentPage, content, content.assignmentId);
    } finally {
      await studentContext.close();
    }

    // ── The aggregation the page renders ────────────────────────────────────
    const after = await readStats(page);
    const { flashcards } = after;
    expect(flashcards.summary.totalPractices, 'the student practices are counted').toBe(
      before.flashcards.summary.totalPractices + CARDS,
    );
    expect(flashcards.summary.totalFlashcards, 'the new cards are counted').toBe(
      before.flashcards.summary.totalFlashcards + CARDS,
    );
    expect(flashcards.summary.difficultyBreakdown.easy, 'three easy cards').toBe(
      before.flashcards.summary.difficultyBreakdown.easy + 3,
    );
    expect(flashcards.summary.difficultyBreakdown.hard, 'one hard card').toBe(
      before.flashcards.summary.difficultyBreakdown.hard + 1,
    );

    const quizRow = after.quizzes.find((quiz) => quiz.title === content.quizName);
    expect(quizRow, `the quiz „${content.quizName}” is reported`).toBeTruthy();
    expect(quizRow!.totalAttempts, 'both attempts are counted').toBe(ATTEMPTS);
    expect(Math.round(quizRow!.avgScore), '2 of 3 answers right').toBe(67);

    const [, , belowHalf] = content.questions;
    const problematic = after.teacher.subject.problematicQuestions.find(
      (question) => question.id === belowHalf.id,
    );
    expect(problematic, 'the question answered 0/2 is problematic').toBeTruthy();
    expect(problematic!.correctRate, 'its correct rate is 0').toBe(0);

    // ── The page itself ────────────────────────────────────────────────────
    await page.goto(RESULTS_PATH);
    await expect(page).toHaveURL(new RegExp(`${RESULTS_PATH}$`));
    await expect(page.getByRole('heading', { level: 1, name: COPY.title })).toBeVisible();
    await expect(page.getByText(COPY.description, { exact: true })).toBeVisible();

    // 1. The five cards, in the order the case lists them, with the values the
    //    page's endpoints report.
    const cards = expectedCards(after);
    const titles = Object.keys(cards);
    await expect(
      page.locator('main div.rounded-xl.border:not([data-slot="card"])'),
      'exactly the five result cards',
    ).toHaveCount(titles.length);
    for (const title of titles) {
      await expect(statCard(page, title), `„${title}” is on the page`).toHaveCount(1);
      await expect(statValue(page, title), `„${title}” value`).toHaveText(cards[title]);
    }

    // 2. The difficulty chart: four buckets, counts from the same stats, adding
    //    up to the teacher's flashcard count.
    await expect(
      namedCard(page, COPY.difficulty).locator('[data-slot="card-title"]'),
      'the difficulty chart is rendered',
    ).toHaveText(COPY.difficulty);
    const breakdown = flashcards.summary.difficultyBreakdown;
    const difficulty = await readDifficulty(page);
    expect(difficulty, 'the chart lists the four buckets in order').toEqual({
      [COPY.buckets[0]]: breakdown.easy,
      [COPY.buckets[1]]: breakdown.medium,
      [COPY.buckets[2]]: breakdown.hard,
      [COPY.buckets[3]]: breakdown.new,
    });
    expect(
      Object.values(difficulty).reduce((sum, value) => sum + value, 0),
      'every flashcard lands in exactly one bucket',
    ).toBe(flashcards.summary.totalFlashcards);

    // 3. „Wyniki quizów” reports this execution's quiz and its attempts.
    const quizCard = namedCard(page, COPY.quizPerformance);
    await expect(quizCard, 'the quiz performance table is rendered').toBeVisible();
    const quizTableRow = quizCard.locator('tbody tr').filter({ hasText: content.quizName });
    await expect(quizTableRow, 'the quiz row is listed').toHaveCount(1);
    await expect(quizTableRow.locator('td').nth(1), 'attempts on that quiz').toHaveText(
      String(ATTEMPTS),
    );
    await expect(quizTableRow.locator('td').nth(2), 'rounded average score').toHaveText('67%');

    // 4. „Problematyczne pytania” lists only the question below 50 %.
    const problematicCard = namedCard(page, COPY.problematic);
    await expect(
      problematicCard.locator('[data-slot="card-title"]'),
      'the problematic-questions card is rendered',
    ).toHaveText(COPY.problematic);
    await expect(problematicCard.locator('[data-slot="card-description"]')).toHaveText(
      COPY.problematicDescription,
    );
    await expect(page.getByText(COPY.noProblematic, { exact: true })).toHaveCount(0);
    const belowHalfRow = problematicRows(page).filter({ hasText: belowHalf.content });
    await expect(belowHalfRow, 'the 0 % question is listed once').toHaveCount(1);
    await expect(
      belowHalfRow.getByText(`0% ${COPY.correctSuffix}`, { exact: true }),
      'with its correct rate',
    ).toBeVisible();
    for (const healthy of [content.questions[0], content.questions[1]]) {
      await expect(
        problematicRows(page).filter({ hasText: healthy.content }),
        'a question answered correctly in every attempt is not listed',
      ).toHaveCount(0);
    }
    await expect(
      problematicRows(page),
      'every problematic question the API reports renders one row',
    ).toHaveCount(after.teacher.subject.problematicQuestions.length);

    // 6. The three links open their own pages.
    const links = [
      { label: COPY.quizStatsLink, href: '/edu/stats/quizzes', marker: 'Statystyki testów' },
      {
        label: COPY.flashcardStatsLink,
        href: '/edu/flashcards/stats',
        marker: 'Statystyki fiszek',
      },
      { label: COPY.questionStatsLink, href: '/edu/statistics', marker: 'Pytania według typu' },
    ] as const;
    for (const link of links) {
      const anchor = page.locator(`main a[href="${link.href}"]`);
      await expect(anchor, `„${link.label}” link`).toHaveCount(1);
      await expect(anchor).toContainText(link.label);
      await anchor.click();
      await expect(page, `„${link.label}” opens ${link.href}`).toHaveURL(
        new RegExp(`${link.href}$`),
      );
      await expect(page.getByText(link.marker, { exact: true }).first()).toBeVisible();
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`${RESULTS_PATH}$`));
    }

    expect(failedRequests, 'no API request may fail during the walk').toEqual([]);
    expect(pageErrors, 'uncaught page errors during the walk').toEqual([]);
  });

  test('shows the empty problematic-questions state for an educator without questions', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const pageErrors: string[] = [];
    const failedRequests: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('response', (response) => {
      if (response.status() >= 400 && response.url().includes('/api/v1/')) {
        failedRequests.push(`${response.status()} ${new URL(response.url()).pathname}`);
      }
    });

    const tenant = loadTenant(CASE);
    expect(tenant.users.teacher2, 'the tenant seeds a second educator').toBeTruthy();

    await loginAs(page, tenant, 'teacher2', { locale: 'pl', waitFor: /\/edu/ });

    // `teacher2` never creates questions, so this branch is stable across runs.
    const stats = await readStats(page);
    expect(
      stats.teacher.subject.problematicQuestions,
      'the second educator has no questions of their own',
    ).toEqual([]);

    await page.goto(RESULTS_PATH);
    await expect(page).toHaveURL(new RegExp(`${RESULTS_PATH}$`));
    await expect(page.getByRole('heading', { level: 1, name: COPY.title })).toBeVisible();

    const cards = expectedCards(stats);
    for (const [title, value] of Object.entries(cards)) {
      await expect(statValue(page, title), `„${title}” value`).toHaveText(value);
    }

    const problematicCard = namedCard(page, COPY.problematic);
    await expect(
      problematicCard.locator('[data-slot="card-title"]'),
      'the problematic-questions card is rendered',
    ).toHaveText(COPY.problematic);
    await expect(
      problematicCard.getByText(COPY.noProblematic, { exact: true }),
      'the empty state is shown',
    ).toBeVisible();
    await expect(problematicRows(page), 'no question rows in the empty state').toHaveCount(0);

    for (const link of [
      { label: COPY.quizStatsLink, href: '/edu/stats/quizzes' },
      { label: COPY.flashcardStatsLink, href: '/edu/flashcards/stats' },
      { label: COPY.questionStatsLink, href: '/edu/statistics' },
    ]) {
      const anchor = page.locator(`main a[href="${link.href}"]`);
      await expect(anchor, `„${link.label}” link`).toHaveCount(1);
      await expect(anchor).toContainText(link.label);
    }

    expect(failedRequests, 'no API request may fail').toEqual([]);
    expect(pageErrors, 'uncaught page errors').toEqual([]);
  });
});
