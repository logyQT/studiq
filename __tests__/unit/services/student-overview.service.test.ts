import { AccountType, type RequestContext } from '@studiq/authz';
import { StudentOverviewController } from '@studiq/server/controllers/student-overview.controller';
import { failure, success } from '@studiq/server/lib/service-result';
import {
  countDraftAnswers,
  StudentOverviewService,
} from '@studiq/server/services/student-overview.service';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';
import { asService } from '#test/helpers/service-double';
import { firstRecorded, requiredValue } from '#test/mocks/recorded';

// #655: the data behind "continue where you left off", today's progress and the recent activity
// timeline. Everything is the caller's own, read through the request client.

const ctx: RequestContext = {
  userId: 'student-1',
  accountType: AccountType.STUDENT,
  traceId: 't',
  url: '',
  method: 'GET',
  activeOrgId: null,
  orgRoleId: null,
  groupIds: [],
  permissionScopes: {},
};

const NOW = new Date('2026-10-27T12:00:00Z');

type QueryResult = { data?: unknown; error?: unknown };

/** A thenable query builder that resolves to `result` whatever is chained on it. */
type QueryBuilder = {
  select: Mock;
  eq: Mock;
  is: Mock;
  not: Mock;
  gte: Mock;
  order: Mock;
  limit: Mock;
  in: Mock;
  range: Mock;
  maybeSingle: Mock;
} & Pick<Promise<QueryResult>, 'then'>;

function builder(result: { data: unknown; error?: unknown }): QueryBuilder {
  const resolved: QueryResult = { error: null, ...result };
  const promise = Promise.resolve(resolved);
  const b: QueryBuilder = {
    select: vi.fn(() => b),
    eq: vi.fn(() => b),
    is: vi.fn(() => b),
    not: vi.fn(() => b),
    gte: vi.fn(() => b),
    order: vi.fn(() => b),
    limit: vi.fn(() => b),
    in: vi.fn(() => b),
    range: vi.fn(() => b),
    maybeSingle: vi.fn().mockResolvedValue(resolved),
    then: promise.then.bind(promise),
  };
  return b;
}

interface Tables {
  open?: unknown[];
  sessions?: unknown[];
  completed?: unknown[];
  daily?: unknown;
  deck?: unknown;
  /** id -> name of question banks referenced by attempt configs. */
  question_banks?: unknown[];
  /** attempt id -> number of closed (gradable) questions in its snapshot. */
  gradable?: Record<string, number>;
  errorOn?: string;
}

function service(tables: Tables) {
  // `quiz_attempts` is read twice: first the open attempt, then the completed ones.
  const attemptQueue = [
    builder({ data: tables.open ?? [] }),
    builder({ data: tables.completed ?? [] }),
  ];
  const builders: Record<string, QueryBuilder> = {};
  const from = vi.fn((table: string) => {
    if (tables.errorOn === table)
      return builder({ data: null, error: { code: 'XX000', message: 'boom' } });
    if (table === 'quiz_attempts') return attemptQueue.shift();
    const tableBuilders: Record<string, () => QueryBuilder> = {
      flashcard_study_sessions: () => builder({ data: tables.sessions ?? [] }),
      user_daily_activity: () => builder({ data: tables.daily ?? null }),
      flashcard_decks: () => builder({ data: tables.deck ?? null }),
      question_banks: () => builder({ data: tables.question_banks ?? [] }),
      quiz_attempt_questions: () =>
        builder({
          data: Object.entries(tables.gradable ?? {}).flatMap(([attempt_id, n]) =>
            Array.from({ length: n }, () => ({ attempt_id, questions: { type: 'mcq' } })),
          ),
        }),
    };
    const b = requiredValue(tableBuilders[table], table)();
    builders[table] = b;
    return b;
  });
  const client = mockSupabaseClient();
  client.from.mockImplementation(from);
  return {
    service: new StudentOverviewService(() => Promise.resolve(client)),
    from,
    attemptQueue,
    builders,
  };
}

describe('StudentOverviewService.getOverview', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is empty for a student who has done nothing', async () => {
    const { service: s } = service({});

    const result = await s.getOverview(ctx, NOW);

    expect(result.success && result.data).toEqual({
      resume: { quiz: null, deck: null },
      reviewedToday: 0,
      activity: [],
    });
  });

  it('offers the unfinished practice quiz with its progress', async () => {
    const { service: s, attemptQueue } = service({
      open: [
        {
          id: 'att-1',
          total_questions: 10,
          started_at: '2026-10-27T10:00:00Z',
          config: { bankId: 'bank-1' },
          // 4 of the 10 are answered; an empty selection and blank text do not count.
          draft_answers: {
            q1: { selected_answer_id: 'a', text_answer: null },
            q2: { selected_answer_id: 'b', text_answer: null },
            q3: { selected_answer_id: null, text_answer: 'free text' },
            q4: { selected_answer_id: 'c', text_answer: null },
            q5: { selected_answer_id: null, text_answer: '  ' },
            q6: { selected_answer_id: null, text_answer: null },
          },
        },
      ],
      question_banks: [{ id: 'bank-1', name: 'Fizyka' }],
    });
    const open = firstRecorded(attemptQueue, 'the open-attempt query');

    const result = await s.getOverview(ctx, NOW);

    expect(result.success && result.data.resume.quiz).toEqual({
      attemptId: 'att-1',
      title: 'Fizyka',
      answered: 4,
      total: 10,
      startedAt: '2026-10-27T10:00:00Z',
    });
    // Only the caller's own, unfinished, non-assignment attempts of the last 7 days.
    expect(open.eq).toHaveBeenCalledWith('user_id', 'student-1');
    expect(open.is).toHaveBeenCalledWith('completed_at', null);
    expect(open.eq).toHaveBeenCalledWith('is_assignment_attempt', false);
    expect(open.gte).toHaveBeenCalledWith('started_at', '2026-10-20T12:00:00.000Z');
  });

  it('offers the deck of the latest session that had one, by name', async () => {
    const { service: s } = service({
      sessions: [
        { completed_at: '2026-10-27T09:00:00Z', cards_studied: 5, deck_ids: [] },
        { completed_at: '2026-10-26T09:00:00Z', cards_studied: 8, deck_ids: ['deck-1', 'deck-2'] },
      ],
      deck: { id: 'deck-1', name: 'Anatomia' },
    });

    const result = await s.getOverview(ctx, NOW);

    expect(result.success && result.data.resume.deck).toEqual({
      deckId: 'deck-1',
      name: 'Anatomia',
      lastStudiedAt: '2026-10-26T09:00:00Z',
    });
  });

  it('offers no deck when it was deleted or is not readable any more', async () => {
    const { service: s } = service({
      sessions: [{ completed_at: '2026-10-26T09:00:00Z', cards_studied: 8, deck_ids: ['gone'] }],
      deck: null,
    });

    const result = await s.getOverview(ctx, NOW);

    expect(result.success && result.data.resume.deck).toBeNull();
  });

  it('reports the reviews done today', async () => {
    const { service: s, builders } = service({ daily: { reviews_count: 12 } });

    const result = await s.getOverview(ctx, NOW);

    expect(result.success && result.data.reviewedToday).toBe(12);
    expect(
      requiredValue(builders.user_daily_activity, 'user_daily_activity').eq,
    ).toHaveBeenCalledWith('date', '2026-10-27');
  });

  it('merges sessions and attempts into one timeline, newest first, with scores on their own scale', async () => {
    const { service: s } = service({
      // All five questions of the quiz are closed ones.
      gradable: { 'quiz-1': 5 },
      sessions: [{ completed_at: '2026-10-27T11:00:00Z', cards_studied: 9, deck_ids: [] }],
      question_banks: [{ id: 'bank-a', name: 'Quiz A' }],
      completed: [
        {
          id: 'quiz-1',
          score: 4,
          total_questions: 5,
          total_points: null,
          completed_at: '2026-10-27T08:00:00Z',
          is_assignment_attempt: false,
          config: { bankId: 'bank-a' },
          teacher_assignments: null,
        },
        {
          id: 'asg-1',
          score: 7,
          total_questions: 5,
          total_points: 10,
          completed_at: '2026-10-27T10:00:00Z',
          is_assignment_attempt: true,
          config: null,
          teacher_assignments: { title: 'Kartkówka', show_results: true },
        },
      ],
    });

    const result = await s.getOverview(ctx, NOW);
    const activity = result.success ? result.data.activity : [];

    expect(activity.map((i) => i.kind)).toEqual([
      'flashcards_studied',
      'assignment_submitted',
      'quiz_completed',
    ]);
    expect(activity[0]).toMatchObject({ cardsStudied: 9, scorePct: null, attemptId: null });
    expect(activity[1]).toMatchObject({ title: 'Kartkówka', scorePct: 70, attemptId: 'asg-1' });
    expect(activity[2]).toMatchObject({ title: 'Quiz A', scorePct: 80 });
  });

  it('uses the closed questions as the denominator of a practice quiz, like the review page', async () => {
    const { service: s } = service({
      gradable: { 'quiz-1': 4 },
      question_banks: [{ id: 'bank-mixed', name: 'Mixed' }],
      completed: [
        {
          id: 'quiz-1',
          score: 2,
          total_questions: 10, // six open questions can never be graded
          total_points: null,
          completed_at: '2026-10-27T08:00:00Z',
          is_assignment_attempt: false,
          config: { bankId: 'bank-mixed' },
          teacher_assignments: null,
        },
      ],
    });

    const result = await s.getOverview(ctx, NOW);

    expect(result.success && result.data.activity[0]?.scorePct).toBe(50);
  });

  it('shows no title when a practice quiz has no bank (neutral copy is rendered by the UI)', async () => {
    const { service: s } = service({
      completed: [
        {
          id: 'quiz-1',
          score: 2,
          total_questions: 5,
          total_points: null,
          completed_at: '2026-10-27T08:00:00Z',
          assignment_id: null,
          // A real GenerateQuizInput never carries `title`; topic-only quizzes have no bank.
          config: { topicIds: ['topic-1'] },
          teacher_assignments: null,
        },
      ],
    });

    const result = await s.getOverview(ctx, NOW);

    expect(result.success && result.data.activity[0]?.title).toBeNull();
  });

  it('leaves the percentage out when a practice quiz has no closed question', async () => {
    const { service: s } = service({
      gradable: {},
      completed: [
        {
          id: 'quiz-1',
          score: 0,
          total_questions: 3,
          total_points: null,
          completed_at: '2026-10-27T08:00:00Z',
          is_assignment_attempt: false,
          config: null,
          teacher_assignments: null,
        },
      ],
    });

    const result = await s.getOverview(ctx, NOW);

    expect(result.success && result.data.activity[0]?.scorePct).toBeNull();
  });

  it('does not leak the result of an assignment the teacher withholds', async () => {
    const { service: s } = service({
      completed: [
        {
          id: 'asg-1',
          score: 10,
          total_questions: 5,
          total_points: 10,
          completed_at: '2026-10-27T10:00:00Z',
          is_assignment_attempt: true,
          config: null,
          teacher_assignments: { title: 'Sprawdzian', show_results: false },
        },
      ],
    });

    const result = await s.getOverview(ctx, NOW);

    expect(result.success && result.data.activity[0]?.scorePct).toBeNull();
  });

  // #1141: deleting an assignment nulls `quiz_attempts.assignment_id`; the durable
  // `is_assignment_attempt` marker is what keeps its finished attempts from turning into practice
  // quizzes.
  describe('an attempt whose assignment was deleted (#1141)', () => {
    const deleted = {
      id: 'asg-gone',
      score: 7,
      total_questions: 5,
      total_points: 10,
      completed_at: '2026-10-27T10:00:00Z',
      // What the database holds once the assignment is gone: the FK is nulled, the marker is not.
      assignment_id: null,
      is_assignment_attempt: true,
      config: null,
      teacher_assignments: null,
    };

    it('stays a submitted assignment, with no title and no result to leak', async () => {
      const { service: s, from } = service({ completed: [deleted] });

      const result = await s.getOverview(ctx, NOW);

      expect(result.success && result.data.activity[0]).toMatchObject({
        kind: 'assignment_submitted',
        title: null,
        scorePct: null,
        attemptId: 'asg-gone',
      });
      // It is not a practice quiz, so its closed questions are never counted.
      expect(from).not.toHaveBeenCalledWith('quiz_attempt_questions');
    });

    it('reads the marker, not the nullable foreign key', async () => {
      const { service: s, attemptQueue } = service({ completed: [deleted] });
      const completed = requiredValue(attemptQueue[1], 'the completed-attempts query');

      await s.getOverview(ctx, NOW);

      expect(completed.select).toHaveBeenCalledWith(
        expect.stringContaining('is_assignment_attempt'),
      );
      expect(completed.select).toHaveBeenCalledWith(expect.not.stringContaining('assignment_id'));
    });

    it('still counts a practice quiz next to it on its own closed questions', async () => {
      const { service: s } = service({
        gradable: { 'quiz-1': 4 },
        completed: [
          deleted,
          {
            id: 'quiz-1',
            score: 2,
            total_questions: 10,
            total_points: null,
            completed_at: '2026-10-27T08:00:00Z',
            is_assignment_attempt: false,
            config: { title: 'Mixed' },
            teacher_assignments: null,
          },
        ],
      });

      const result = await s.getOverview(ctx, NOW);
      const activity = result.success ? result.data.activity : [];

      expect(activity.map((item) => item.kind)).toEqual(['assignment_submitted', 'quiz_completed']);
      expect(activity[1]).toMatchObject({ title: 'Mixed', scorePct: 50 });
    });
  });

  it('divides an assignment attempt by its points even when the foreign key is gone (#1141)', async () => {
    // 7 of 10 points over 5 questions: the closed-question denominator of a practice quiz would
    // read 140 % and clamp to 100 %, or no percentage at all.
    const { service: s } = service({
      completed: [
        {
          id: 'asg-1',
          score: 7,
          total_questions: 5,
          total_points: 10,
          completed_at: '2026-10-27T10:00:00Z',
          assignment_id: null,
          is_assignment_attempt: true,
          config: null,
          teacher_assignments: { title: 'Kartkówka', show_results: true },
        },
      ],
    });

    const result = await s.getOverview(ctx, NOW);

    expect(result.success && result.data.activity[0]).toMatchObject({
      kind: 'assignment_submitted',
      scorePct: 70,
    });
  });

  it('keeps only the eight newest lines', async () => {
    const sessions = Array.from({ length: 8 }, (_, i) => ({
      completed_at: `2026-10-2${i}T09:00:00Z`,
      cards_studied: i,
      deck_ids: [],
    }));
    const completed = Array.from({ length: 5 }, (_, i) => ({
      id: `q${i}`,
      score: 1,
      total_questions: 2,
      total_points: null,
      completed_at: `2026-10-1${i}T09:00:00Z`,
      is_assignment_attempt: false,
      config: null,
      teacher_assignments: null,
    }));
    const { service: s } = service({ sessions, completed });

    const result = await s.getOverview(ctx, NOW);

    expect(result.success && result.data.activity).toHaveLength(8);
  });

  it.each(['quiz_attempts', 'flashcard_study_sessions', 'user_daily_activity'])(
    'fails when reading %s fails',
    async (table) => {
      const { service: s } = service({ errorOn: table });
      expect((await s.getOverview(ctx, NOW)).success).toBe(false);
    },
  );
});

describe('StudentOverviewController', () => {
  const overview = { getOverview: vi.fn() };
  const controller = new StudentOverviewController(asService<StudentOverviewService>(overview));

  it('answers 200 with the overview', async () => {
    const data = { resume: { quiz: null, deck: null }, reviewedToday: 0, activity: [] };
    overview.getOverview.mockResolvedValue(success(data));

    expect(await controller.getOverview(ctx)).toMatchObject({
      success: true,
      statusCode: 200,
      data,
    });
  });

  it('maps a service failure to its HTTP error', async () => {
    overview.getOverview.mockResolvedValue(failure('INTERNAL_SERVER'));

    expect(await controller.getOverview(ctx)).toMatchObject({ success: false, statusCode: 500 });
  });
});

describe('countDraftAnswers', () => {
  it('counts a selection or non-blank text, nothing else', () => {
    expect(
      countDraftAnswers({
        a: { selected_answer_id: 'x', text_answer: null },
        b: { selected_answer_id: null, text_answer: 'hello' },
        c: { selected_answer_id: null, text_answer: '   ' },
        d: { selected_answer_id: '', text_answer: null },
        e: null,
        f: 'oops',
      }),
    ).toBe(2);
  });

  it('is 0 for a missing or malformed column', () => {
    expect(countDraftAnswers(null)).toBe(0);
    expect(countDraftAnswers([])).toBe(0);
    expect(countDraftAnswers('x')).toBe(0);
  });
});
