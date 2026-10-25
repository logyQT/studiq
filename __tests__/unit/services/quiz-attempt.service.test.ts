import { AccountType, type RequestContext } from '@studiq/authz';
import { QuizAttemptService } from '@studiq/server/services/quiz-attempt.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

function qb(data: any, error: any = null) {
  const result = { data: data ?? null, error };
  const promise = Promise.resolve(result);
  const b: any = {};
  b.select = vi.fn(() => b);
  b.insert = vi.fn(() => b);
  b.update = vi.fn(() => b);
  b.delete = vi.fn(() => b);
  b.eq = vi.fn(() => b);
  b.in = vi.fn(() => b);
  b.order = vi.fn(() => b);
  b.limit = vi.fn(() => b);
  b.or = vi.fn(() => b);
  b.not = vi.fn(() => b);
  b.neq = vi.fn(() => b);
  b.is = vi.fn(() => b);
  b.rpc = vi.fn(() => b);
  b.single = vi.fn().mockResolvedValue(result);
  b.maybeSingle = vi.fn().mockResolvedValue(result);
  b.then = promise.then.bind(promise);
  b.catch = promise.catch.bind(promise);
  b.finally = promise.finally.bind(promise);
  return b;
}

describe('QuizAttemptService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  let service: QuizAttemptService;
  const ctx: RequestContext = {
    userId: 'test-user-id',
    accountType: AccountType.STUDENT,
    traceId: 'test',
    url: '',
    method: 'GET',
    activeOrgId: null,
    orgRoleId: null,
    groupIds: [],
    permissionScopes: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
    service = new QuizAttemptService(async () => mock as any);
  });

  describe('list', () => {
    it('returns attempts for user', async () => {
      const attempts = [{ id: 'a-1', user_id: ctx.userId, score: 5 }];
      mock.from.mockReturnValueOnce(qb(attempts));

      const result = await service.list(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(attempts);
    });

    it('returns INTERNAL_SERVER when query fails', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.list(ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });

    it('does not look up assignments when the caller has only practice attempts (#374)', async () => {
      mock.from.mockReturnValueOnce(qb([{ id: 'a-1', user_id: ctx.userId, score: 5 }]));

      const result = await service.list(ctx);

      expect(result.success).toBe(true);
      // Fail closed would be pointless here: there is no assignment flag to read.
      expect(mock.from).toHaveBeenCalledTimes(1);
    });

    it('withholds the score of a hidden assignment attempt (#374)', async () => {
      mock.from.mockReturnValueOnce(
        qb([
          { id: 'a-1', user_id: ctx.userId, score: 3, assignment_id: 'assignment-hidden' },
          { id: 'a-2', user_id: ctx.userId, score: 2, assignment_id: 'assignment-visible' },
          { id: 'a-3', user_id: ctx.userId, score: 1, assignment_id: null },
        ]),
      );
      mock.from.mockReturnValueOnce(
        qb([
          { id: 'assignment-hidden', show_results: false },
          { id: 'assignment-visible', show_results: true },
        ]),
      );

      const result = await service.list(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toEqual([
        expect.objectContaining({ id: 'a-1', score: null }),
        expect.objectContaining({ id: 'a-2', score: 2 }),
        expect.objectContaining({ id: 'a-3', score: 1 }),
      ]);
    });

    it('fails closed when the assignment lookup fails (#374)', async () => {
      mock.from.mockReturnValueOnce(qb([{ id: 'a-1', score: 3, assignment_id: 'assignment-1' }]));
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.list(ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });
  });

  describe('getById', () => {
    it('returns attempt with questions and answers', async () => {
      const attempt = { id: 'a-1', user_id: ctx.userId, completed_at: '2026-10-24T10:00:00.000Z' };
      const attemptQuestions = [{ order_index: 0, question_id: 'q-1', questions: { id: 'q-1' } }];
      const answers = [
        {
          question_id: 'q-1',
          selected_option_id: 'ans-1',
          text_answer: null,
          is_correct: true,
          teacher_points: null,
          teacher_feedback: null,
        },
      ];

      mock.from.mockReturnValueOnce(qb(attempt));
      mock.from.mockReturnValueOnce(qb(attemptQuestions));
      mock.from.mockReturnValueOnce(qb(answers));

      const result = await service.getById('a-1', ctx);

      expect(result.success).toBe(true);
      expect((result.data as any).questions).toBeDefined();
      expect((result.data as any).answers).toBeDefined();
    });

    it('returns NOT_FOUND when attempt does not exist', async () => {
      mock.from.mockReturnValueOnce(qb(null, null));

      const result = await service.getById('nonexistent', ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });

    it('projects only take-page columns while the attempt is in progress (#331)', async () => {
      const attempt = { id: 'a-1', user_id: ctx.userId, completed_at: null };
      const questionsBuilder = qb([
        { order_index: 0, question_id: 'q-1', questions: { id: 'q-1' } },
      ]);

      mock.from.mockReturnValueOnce(qb(attempt));
      mock.from.mockReturnValueOnce(questionsBuilder);
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.getById('a-1', ctx);

      expect(result.success).toBe(true);
      const projection = questionsBuilder.select.mock.calls[0][0] as string;
      expect(projection).not.toContain('*');
      expect(projection).not.toContain('is_correct');
      expect(projection).not.toContain('explanation');
      expect(projection).not.toContain('search_vector');
      expect(projection).toContain('question_answers:question_options(id, content)');
    });

    it('includes the answer key once the attempt is completed (#331)', async () => {
      const attempt = {
        id: 'a-1',
        user_id: ctx.userId,
        completed_at: '2026-10-24T10:00:00.000Z',
      };
      const questionsBuilder = qb([
        { order_index: 0, question_id: 'q-1', questions: { id: 'q-1' } },
      ]);

      mock.from.mockReturnValueOnce(qb(attempt));
      mock.from.mockReturnValueOnce(questionsBuilder);
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.getById('a-1', ctx);

      expect(result.success).toBe(true);
      const projection = questionsBuilder.select.mock.calls[0][0] as string;
      expect(projection).toContain('explanation');
      expect(projection).toContain('is_correct');
    });

    it('omits is_correct from the answers map while the attempt is in progress (#331)', async () => {
      const attempt = { id: 'a-1', user_id: ctx.userId, completed_at: null };

      mock.from.mockReturnValueOnce(qb(attempt));
      mock.from.mockReturnValueOnce(qb([]));
      // Graded rows cannot appear before submission — only the draft is served.
      mock.from.mockReturnValueOnce(
        qb([
          {
            question_id: 'q-1',
            selected_option_id: 'ans-1',
            text_answer: null,
            is_correct: true,
          },
        ]),
      );

      const result = await service.getById('a-1', ctx);

      expect(result.success).toBe(true);
      expect((result.data as any).answers).toEqual({});
    });

    it('serves the saved draft as `answers` for an in-progress attempt (#349)', async () => {
      const attempt = {
        id: 'a-1',
        user_id: ctx.userId,
        completed_at: null,
        draft_answers: {
          'q-1': { selected_answer_id: 'ans-1', text_answer: null },
          'q-2': { selected_answer_id: null, text_answer: 'Wisła' },
        },
      };

      mock.from.mockReturnValueOnce(qb(attempt));
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.getById('a-1', ctx);

      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.answers).toEqual({
        'q-1': { selected_answer_id: 'ans-1', text_answer: null },
        'q-2': { selected_answer_id: null, text_answer: 'Wisła' },
      });
      expect(data.answers['q-1']).not.toHaveProperty('is_correct');
      // The raw column must never be serialised.
      expect(data).not.toHaveProperty('draft_answers');
    });

    it('drops anything but the student selection out of a tampered draft (#331)', async () => {
      const attempt = {
        id: 'a-1',
        user_id: ctx.userId,
        completed_at: null,
        draft_answers: {
          'q-1': { selected_answer_id: 'ans-1', text_answer: null, is_correct: true },
          'q-2': 'not-an-object',
          'q-3': null,
        },
      };

      mock.from.mockReturnValueOnce(qb(attempt));
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.getById('a-1', ctx);

      expect(result.success).toBe(true);
      const data = result.data as any;
      expect(data.answers).toEqual({
        'q-1': { selected_answer_id: 'ans-1', text_answer: null },
      });
      expect(data.answers['q-1']).not.toHaveProperty('is_correct');
    });

    it('ignores the draft once the attempt is completed (#349)', async () => {
      const attempt = {
        id: 'a-1',
        user_id: ctx.userId,
        completed_at: '2026-10-24T10:00:00.000Z',
        draft_answers: { 'q-1': { selected_answer_id: 'stale', text_answer: null } },
      };

      mock.from.mockReturnValueOnce(qb(attempt));
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(
        qb([
          {
            question_id: 'q-1',
            selected_option_id: 'ans-1',
            text_answer: null,
            is_correct: true,
          },
        ]),
      );

      const result = await service.getById('a-1', ctx);

      expect(result.success).toBe(true);
      expect((result.data as any).answers).toEqual({
        'q-1': { selected_answer_id: 'ans-1', text_answer: null, is_correct: true },
      });
    });

    it('keeps is_correct in the answers map for a completed attempt (#331)', async () => {
      const attempt = {
        id: 'a-1',
        user_id: ctx.userId,
        completed_at: '2026-10-24T10:00:00.000Z',
      };

      mock.from.mockReturnValueOnce(qb(attempt));
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(
        qb([
          {
            question_id: 'q-1',
            selected_option_id: 'ans-1',
            text_answer: null,
            is_correct: true,
          },
        ]),
      );

      const result = await service.getById('a-1', ctx);

      expect(result.success).toBe(true);
      expect((result.data as any).answers['q-1'].is_correct).toBe(true);
    });

    it('includes teacher grading in the answers map for a completed attempt (#175)', async () => {
      const attempt = {
        id: 'a-1',
        user_id: ctx.userId,
        assignment_id: 'assignment-1',
        completed_at: '2026-10-24T10:00:00.000Z',
      };

      mock.from.mockReturnValueOnce(qb(attempt));
      mock.from.mockReturnValueOnce(qb([{ id: 'assignment-1', show_results: true }]));
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(
        qb([
          {
            question_id: 'q-open',
            selected_option_id: null,
            text_answer: 'Rozbiory',
            is_correct: false,
            teacher_points: 2,
            teacher_feedback: 'Dobrze, ale brakuje liberum veto.',
          },
        ]),
      );

      const result = await service.getById('a-1', ctx);

      expect(result.success).toBe(true);
      expect((result.data as any).answers['q-open']).toEqual({
        selected_answer_id: null,
        text_answer: 'Rozbiory',
        is_correct: false,
        teacher_points: 2,
        teacher_feedback: 'Dobrze, ale brakuje liberum veto.',
      });
    });

    it('refuses the review of a completed attempt when show_results is off (#374)', async () => {
      const attempt = {
        id: 'a-1',
        user_id: ctx.userId,
        assignment_id: 'assignment-1',
        completed_at: '2026-10-24T10:00:00.000Z',
      };

      mock.from.mockReturnValueOnce(qb(attempt));
      mock.from.mockReturnValueOnce(qb([{ id: 'assignment-1', show_results: false }]));

      const result = await service.getById('a-1', ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
      // No answer key / graded rows may even be loaded.
      expect(mock.from.mock.calls.map((call) => call[0])).toEqual([
        'quiz_attempts',
        'teacher_assignments',
      ]);
    });

    it('fails closed when the assignment row is missing (#374)', async () => {
      const attempt = {
        id: 'a-1',
        user_id: ctx.userId,
        assignment_id: 'assignment-1',
        completed_at: '2026-10-24T10:00:00.000Z',
      };

      mock.from.mockReturnValueOnce(qb(attempt));
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.getById('a-1', ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('FORBIDDEN');
    });

    it('keeps resuming a running assignment attempt without reading show_results (#374)', async () => {
      const attempt = {
        id: 'a-1',
        user_id: ctx.userId,
        assignment_id: 'assignment-1',
        completed_at: null,
        draft_answers: { 'q-1': { selected_answer_id: 'ans-1', text_answer: null } },
      };

      mock.from.mockReturnValueOnce(qb(attempt));
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(qb([]));

      const result = await service.getById('a-1', ctx);

      expect(result.success).toBe(true);
      expect((result.data as any).answers).toEqual({
        'q-1': { selected_answer_id: 'ans-1', text_answer: null },
      });
      expect(mock.from).not.toHaveBeenCalledWith('teacher_assignments');
    });
  });

  describe('submit', () => {
    it('submits answers and returns score', async () => {
      const attempt = { id: 'a-1', user_id: ctx.userId, completed_at: null };
      const answer = { id: 'ans-1', is_correct: true };
      const insertQb = qb(null);

      mock.from.mockReturnValueOnce(qb(attempt));
      mock.from.mockReturnValueOnce(qb([{ id: 'q-1', type: 'mcq' }]));
      mock.from.mockReturnValueOnce(qb(answer));
      mock.from.mockReturnValueOnce(qb(null));
      mock.from.mockReturnValueOnce(insertQb);

      const result = await service.submit(
        {
          attemptId: 'a-1',
          answers: [{ questionId: 'q-1', selectedAnswerId: 'ans-1' }],
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect((result.data as any).score).toBe(1);
      // Practice quizzes must not look up assignment points.
      expect(mock.from).not.toHaveBeenCalledWith('assignment_questions');
      expect(insertQb.insert).toHaveBeenCalledWith([
        expect.objectContaining({
          question_id: 'q-1',
          selected_option_id: 'ans-1',
          text_answer: null,
          question_type: 'mcq',
          is_correct: true,
        }),
      ]);
    });

    it('counts a practice-quiz question once even when it produced several answer rows', async () => {
      const attempt = { id: 'a-1', user_id: ctx.userId, completed_at: null };

      mock.from.mockReturnValueOnce(qb(attempt));
      mock.from.mockReturnValueOnce(qb([{ id: 'q-1', type: 'mcq' }]));
      mock.from.mockReturnValueOnce(qb({ is_correct: true }));
      mock.from.mockReturnValueOnce(qb({ is_correct: true }));
      mock.from.mockReturnValueOnce(qb(null)); // attempt update
      mock.from.mockReturnValueOnce(qb(null)); // answers insert

      const result = await service.submit(
        {
          attemptId: 'a-1',
          answers: [
            { questionId: 'q-1', selectedAnswerId: 'ans-1' },
            { questionId: 'q-1', selectedAnswerId: 'ans-2' },
          ],
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect((result.data as any).score).toBe(1);
      expect(mock.from).not.toHaveBeenCalledWith('assignment_questions');
    });

    it('stores an open answer as text and does not auto-score it', async () => {
      const attempt = { id: 'a-1', user_id: ctx.userId, completed_at: null };
      const insertQb = qb(null);

      mock.from.mockReturnValueOnce(qb(attempt));
      mock.from.mockReturnValueOnce(qb([{ id: 'q-open', type: 'open' }]));
      mock.from.mockReturnValueOnce(qb(null));
      mock.from.mockReturnValueOnce(insertQb);

      const result = await service.submit(
        {
          attemptId: 'a-1',
          answers: [
            {
              questionId: 'q-open',
              textAnswer: '  Rozbiory, słaba władza centralna, liberum veto.  ',
            },
          ],
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect((result.data as any).score).toBe(0);
      expect(insertQb.insert).toHaveBeenCalledWith([
        {
          attempt_id: 'a-1',
          question_id: 'q-open',
          question_type: 'open',
          selected_option_id: null,
          text_answer: 'Rozbiory, słaba władza centralna, liberum veto.',
          is_correct: false,
        },
      ]);
      // No option lookup is performed for an open question.
      expect(mock.from).toHaveBeenCalledTimes(4);
    });

    it('awards assignment points instead of counting correct answers (#167)', async () => {
      const attempt = {
        id: 'a-1',
        user_id: ctx.userId,
        completed_at: null,
        assignment_id: 'assignment-1',
      };

      mock.from.mockReturnValueOnce(qb(attempt));
      mock.from.mockReturnValueOnce(qb({ deadline: null, show_results: true })); // teacher_assignments
      mock.from.mockReturnValueOnce(qb([{ question_id: 'q-1', points: 2 }]));
      mock.from.mockReturnValueOnce(qb([{ id: 'q-1', type: 'mcq' }]));
      mock.from.mockReturnValueOnce(qb({ is_correct: true })); // question_options
      mock.from.mockReturnValueOnce(qb(null)); // attempt update
      mock.from.mockReturnValueOnce(qb(null)); // answers insert

      const result = await service.submit(
        {
          attemptId: 'a-1',
          answers: [{ questionId: 'q-1', selectedAnswerId: 'ans-1' }],
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect((result.data as any).score).toBe(2);
    });

    it('withholds the score of a hidden assignment after submission (#374)', async () => {
      const attempt = {
        id: 'a-1',
        user_id: ctx.userId,
        completed_at: null,
        assignment_id: 'assignment-1',
      };

      mock.from.mockReturnValueOnce(qb(attempt));
      mock.from.mockReturnValueOnce(qb({ deadline: null, show_results: false }));
      mock.from.mockReturnValueOnce(qb([{ question_id: 'q-1', points: 2 }]));
      mock.from.mockReturnValueOnce(qb([{ id: 'q-1', type: 'mcq' }]));
      mock.from.mockReturnValueOnce(qb({ is_correct: true }));
      mock.from.mockReturnValueOnce(qb(null));
      mock.from.mockReturnValueOnce(qb(null));

      const result = await service.submit(
        { attemptId: 'a-1', answers: [{ questionId: 'q-1', selectedAnswerId: 'ans-1' }] },
        ctx,
      );

      expect(result.success).toBe(true);
      expect((result.data as any).score).toBeNull();
      // The attempt itself is still scored and stored.
      expect((result.data as any).totalQuestions).toBe(1);
    });

    it('withholds the score when the assignment row is missing (#374)', async () => {
      const attempt = {
        id: 'a-1',
        user_id: ctx.userId,
        completed_at: null,
        assignment_id: 'assignment-1',
      };

      mock.from.mockReturnValueOnce(qb(attempt));
      mock.from.mockReturnValueOnce(qb(null));
      mock.from.mockReturnValueOnce(qb([{ question_id: 'q-1', points: 2 }]));
      mock.from.mockReturnValueOnce(qb([{ id: 'q-1', type: 'mcq' }]));
      mock.from.mockReturnValueOnce(qb({ is_correct: true }));
      mock.from.mockReturnValueOnce(qb(null));
      mock.from.mockReturnValueOnce(qb(null));

      const result = await service.submit(
        { attemptId: 'a-1', answers: [{ questionId: 'q-1', selectedAnswerId: 'ans-1' }] },
        ctx,
      );

      expect(result.success).toBe(true);
      expect((result.data as any).score).toBeNull();
    });

    it('awards a question once even when it produced several answer rows', async () => {
      const attempt = {
        id: 'a-1',
        user_id: ctx.userId,
        completed_at: null,
        assignment_id: 'assignment-1',
      };

      mock.from.mockReturnValueOnce(qb(attempt));
      mock.from.mockReturnValueOnce(qb({ deadline: null, show_results: true }));
      mock.from.mockReturnValueOnce(qb([{ question_id: 'q-1', points: 2 }]));
      mock.from.mockReturnValueOnce(qb([{ id: 'q-1', type: 'mcq' }]));
      mock.from.mockReturnValueOnce(qb({ is_correct: true }));
      mock.from.mockReturnValueOnce(qb({ is_correct: true }));
      mock.from.mockReturnValueOnce(qb(null));
      mock.from.mockReturnValueOnce(qb(null));

      const result = await service.submit(
        {
          attemptId: 'a-1',
          answers: [
            { questionId: 'q-1', selectedAnswerId: 'ans-1' },
            { questionId: 'q-1', selectedAnswerId: 'ans-2' },
          ],
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect((result.data as any).score).toBe(2);
    });

    it('returns INTERNAL_SERVER when assignment points cannot be loaded', async () => {
      const attempt = {
        id: 'a-1',
        user_id: ctx.userId,
        completed_at: null,
        assignment_id: 'assignment-1',
      };

      mock.from.mockReturnValueOnce(qb(attempt));
      mock.from.mockReturnValueOnce(qb({ deadline: null, show_results: true }));
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.submit(
        {
          attemptId: 'a-1',
          answers: [{ questionId: 'q-1', selectedAnswerId: 'ans-1' }],
        },
        ctx,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });

    it('returns NOT_FOUND when attempt does not exist', async () => {
      mock.from.mockReturnValueOnce(qb(null, null));

      const result = await service.submit({ attemptId: 'nonexistent', answers: [] }, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });

    it('returns BAD_REQUEST when attempt already completed', async () => {
      const attempt = { id: 'a-1', user_id: ctx.userId, completed_at: '2024-01-01' };
      mock.from.mockReturnValueOnce(qb(attempt));

      const result = await service.submit({ attemptId: 'a-1', answers: [] }, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('BAD_REQUEST');
    });

    it('clears the draft in the same update that completes the attempt (#349)', async () => {
      const attempt = { id: 'a-1', user_id: ctx.userId, completed_at: null };
      const updateQb = qb(null);

      mock.from.mockReturnValueOnce(qb(attempt));
      mock.from.mockReturnValueOnce(qb([{ id: 'q-1', type: 'mcq' }]));
      mock.from.mockReturnValueOnce(qb({ is_correct: true }));
      mock.from.mockReturnValueOnce(updateQb);
      mock.from.mockReturnValueOnce(qb(null));

      const result = await service.submit(
        { attemptId: 'a-1', answers: [{ questionId: 'q-1', selectedAnswerId: 'ans-1' }] },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(updateQb.update).toHaveBeenCalledWith(
        expect.objectContaining({ score: 1, draft_answers: {} }),
      );
    });
  });

  describe('saveDraft (#349)', () => {
    const questionsQb = () => qb([{ question_id: 'q-1' }, { question_id: 'q-2' }]);

    it('stores the normalised draft map and reports the saved count', async () => {
      const updateQb = qb(null);

      mock.from.mockReturnValueOnce(qb({ id: 'a-1', completed_at: null }));
      mock.from.mockReturnValueOnce(questionsQb());
      mock.from.mockReturnValueOnce(updateQb);

      const result = await service.saveDraft(
        {
          attemptId: 'a-1',
          answers: [
            { questionId: 'q-1', selectedAnswerId: 'ans-1' },
            { questionId: 'q-2', textAnswer: '  Wisła  ' },
          ],
        },
        ctx,
      );

      expect(result.success).toBe(true);
      expect((result.data as any).saved).toBe(2);
      expect(updateQb.update).toHaveBeenCalledWith({
        draft_answers: {
          'q-1': { selected_answer_id: 'ans-1', text_answer: null },
          'q-2': { selected_answer_id: null, text_answer: 'Wisła' },
        },
      });
      // A late autosave must never revive a submitted attempt.
      expect(updateQb.is).toHaveBeenCalledWith('completed_at', null);
      expect(updateQb.eq).toHaveBeenCalledWith('user_id', ctx.userId);
    });

    it('replaces the whole draft, so a cleared answer disappears', async () => {
      const updateQb = qb(null);

      mock.from.mockReturnValueOnce(qb({ id: 'a-1', completed_at: null }));
      mock.from.mockReturnValueOnce(questionsQb());
      mock.from.mockReturnValueOnce(updateQb);

      await service.saveDraft({ attemptId: 'a-1', answers: [] }, ctx);

      expect(updateQb.update).toHaveBeenCalledWith({ draft_answers: {} });
    });

    it('keeps the last value when a question is sent twice', async () => {
      const updateQb = qb(null);

      mock.from.mockReturnValueOnce(qb({ id: 'a-1', completed_at: null }));
      mock.from.mockReturnValueOnce(questionsQb());
      mock.from.mockReturnValueOnce(updateQb);

      await service.saveDraft(
        {
          attemptId: 'a-1',
          answers: [
            { questionId: 'q-1', selectedAnswerId: 'ans-1' },
            { questionId: 'q-1', selectedAnswerId: 'ans-2' },
          ],
        },
        ctx,
      );

      expect(updateQb.update).toHaveBeenCalledWith({
        draft_answers: { 'q-1': { selected_answer_id: 'ans-2', text_answer: null } },
      });
    });

    it('returns NOT_FOUND for a foreign or missing attempt', async () => {
      mock.from.mockReturnValueOnce(qb(null));

      const result = await service.saveDraft({ attemptId: 'a-1', answers: [] }, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_FOUND');
    });

    it('returns BAD_REQUEST when the attempt is already submitted', async () => {
      mock.from.mockReturnValueOnce(qb({ id: 'a-1', completed_at: '2026-10-24T10:00:00.000Z' }));

      const result = await service.saveDraft({ attemptId: 'a-1', answers: [] }, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('BAD_REQUEST');
    });

    it('returns UNPROCESSABLE_ENTITY when a question is not part of the attempt', async () => {
      mock.from.mockReturnValueOnce(qb({ id: 'a-1', completed_at: null }));
      mock.from.mockReturnValueOnce(questionsQb());

      const result = await service.saveDraft(
        { attemptId: 'a-1', answers: [{ questionId: 'q-stranger', selectedAnswerId: 'ans-1' }] },
        ctx,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('returns INTERNAL_SERVER when the draft update fails', async () => {
      mock.from.mockReturnValueOnce(qb({ id: 'a-1', completed_at: null }));
      mock.from.mockReturnValueOnce(questionsQb());
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.saveDraft(
        { attemptId: 'a-1', answers: [{ questionId: 'q-1', selectedAnswerId: 'ans-1' }] },
        ctx,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });

    it('returns INTERNAL_SERVER when the attempt questions cannot be loaded', async () => {
      mock.from.mockReturnValueOnce(qb({ id: 'a-1', completed_at: null }));
      mock.from.mockReturnValueOnce(qb(null, { message: 'DB error' }));

      const result = await service.saveDraft({ attemptId: 'a-1', answers: [] }, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });
  });
});
