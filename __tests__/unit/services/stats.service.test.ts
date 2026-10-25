import { AccountType, type RequestContext } from '@studiq/authz';
import { StatsService } from '@studiq/server/services/stats.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

function qb(data: any, error: any = null, count?: number) {
  const result =
    count !== undefined ? { data: data ?? null, count, error } : { data: data ?? null, error };
  const promise = Promise.resolve(result);
  const b: any = {};
  b.select = vi.fn(() => b);
  b.eq = vi.fn(() => b);
  b.in = vi.fn(() => b);
  b.is = vi.fn(() => b);
  b.not = vi.fn(() => b);
  b.order = vi.fn(() => b);
  b.lte = vi.fn(() => b);
  b.then = promise.then.bind(promise);
  b.catch = promise.catch.bind(promise);
  b.finally = promise.finally.bind(promise);
  return b;
}

describe('StatsService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  const ctx: RequestContext = {
    userId: 'test-user-id',
    accountType: AccountType.STUDENT,
    traceId: 't',
    url: '',
    method: 'GET',
    activeOrgId: null,
    orgRoleId: null,
    groupIds: [],
    permissionScopes: {},
  };
  const service = new StatsService(async () => mock as any);

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
  });

  describe('getTeacherStats', () => {
    beforeEach(() => {
      mock.rpc.mockResolvedValue({ data: [], error: null });
    });

    it('returns totals, the type split and the subject distribution', async () => {
      mock.from.mockReturnValueOnce(qb([{ id: 'q-1', type: 'mcq', bank_id: 'bank-1' }]));
      mock.from.mockReturnValueOnce(qb([{ id: 'fc-1' }]));
      mock.from.mockReturnValueOnce(qb([{ id: 'bank-1', name: 'Historia' }]));

      const result = await service.getTeacherStats(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        totalQuestions: 1,
        totalFlashcards: 1,
        subject: { byType: { mcq: 1 }, problematicQuestions: [] },
        bySubject: [{ subjectId: 'bank-1', subjectName: 'Historia', questionCount: 1 }],
      });
    });

    it('scopes question/flashcard counts to the active organization', async () => {
      const orgCtx: RequestContext = { ...ctx, activeOrgId: 'org-1' };
      const questionsBuilder = qb([{ id: 'q-1', type: 'mcq', bank_id: 'bank-1' }]);
      const flashcardsBuilder = qb([{ id: 'fc-1' }]);
      const banksBuilder = qb([{ id: 'bank-1', name: 'Historia' }]);
      mock.from.mockReturnValueOnce(questionsBuilder);
      mock.from.mockReturnValueOnce(flashcardsBuilder);
      mock.from.mockReturnValueOnce(banksBuilder);

      const result = await service.getTeacherStats(orgCtx);

      expect(result.success).toBe(true);
      expect(questionsBuilder.eq).toHaveBeenCalledWith('organization_id', 'org-1');
      expect(flashcardsBuilder.eq).toHaveBeenCalledWith('organization_id', 'org-1');
    });

    it('groups questions by bank and counts types, sorted by Polish name', async () => {
      mock.from.mockReturnValueOnce(
        qb([
          { id: 'q-1', type: 'mcq', bank_id: 'bank-geo' },
          { id: 'q-2', type: 'true_false', bank_id: 'bank-his' },
          { id: 'q-3', type: 'open', bank_id: 'bank-his' },
          { id: 'q-4', type: 'mcq', bank_id: 'bank-his' },
          { id: 'q-5', type: 'mcq', bank_id: 'bank-gone' },
        ]),
      );
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(
        qb([
          { id: 'bank-his', name: 'Historia' },
          { id: 'bank-geo', name: 'Geografia i Nauka' },
        ]),
      );

      const result = await service.getTeacherStats(ctx);

      expect(result.success).toBe(true);
      expect(result.data.subject.byType).toEqual({ mcq: 3, true_false: 1, open: 1 });
      // localeCompare('pl'): Geografia before Historia; the bank missing from the
      // lookup (RLS / left-org edge case) keeps a null name and sorts last.
      expect(result.data.bySubject).toEqual([
        { subjectId: 'bank-geo', subjectName: 'Geografia i Nauka', questionCount: 1 },
        { subjectId: 'bank-his', subjectName: 'Historia', questionCount: 3 },
        { subjectId: 'bank-gone', subjectName: null, questionCount: 1 },
      ]);
    });

    it('narrows only the type split when a subject is selected', async () => {
      mock.from.mockReturnValueOnce(
        qb([
          { id: 'q-1', type: 'mcq', bank_id: 'bank-his' },
          { id: 'q-2', type: 'mcq', bank_id: 'bank-his' },
          { id: 'q-3', type: 'true_false', bank_id: 'bank-his' },
          { id: 'q-4', type: 'mcq', bank_id: 'bank-geo' },
          { id: 'q-5', type: 'open', bank_id: 'bank-geo' },
        ]),
      );
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(
        qb([
          { id: 'bank-his', name: 'Historia' },
          { id: 'bank-geo', name: 'Geografia i Nauka' },
        ]),
      );

      const result = await service.getTeacherStats(ctx, { subjectId: 'bank-his' });

      expect(result.success).toBe(true);
      expect(result.data.subject.byType).toEqual({ mcq: 2, true_false: 1 });
      // Totals and the by-subject overview stay global.
      expect(result.data.totalQuestions).toBe(5);
      expect(result.data.bySubject).toEqual([
        { subjectId: 'bank-geo', subjectName: 'Geografia i Nauka', questionCount: 2 },
        { subjectId: 'bank-his', subjectName: 'Historia', questionCount: 3 },
      ]);
    });

    it('matches an uppercase subject id as Postgres would', async () => {
      mock.from.mockReturnValueOnce(
        qb([
          { id: 'q-1', type: 'mcq', bank_id: 'bank-his' },
          { id: 'q-2', type: 'mcq', bank_id: 'bank-his' },
          { id: 'q-3', type: 'true_false', bank_id: 'bank-his' },
          { id: 'q-4', type: 'mcq', bank_id: 'bank-geo' },
          { id: 'q-5', type: 'open', bank_id: 'bank-geo' },
        ]),
      );
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(
        qb([
          { id: 'bank-his', name: 'Historia' },
          { id: 'bank-geo', name: 'Geografia i Nauka' },
        ]),
      );

      const result = await service.getTeacherStats(ctx, { subjectId: 'BANK-HIS' });

      expect(result.success).toBe(true);
      expect(result.data.subject.byType).toEqual({ mcq: 2, true_false: 1 });
      expect(result.data.totalQuestions).toBe(5);
      expect(result.data.bySubject).toHaveLength(2);
    });

    it('yields an empty type split for a foreign subject id without widening the query', async () => {
      const questionsBuilder = qb([{ id: 'q-1', type: 'mcq', bank_id: 'bank-his' }]);
      mock.from.mockReturnValueOnce(questionsBuilder);
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(qb([{ id: 'bank-his', name: 'Historia' }]));

      const result = await service.getTeacherStats(ctx, {
        subjectId: '00000000-0000-4000-8020-000000000099',
      });

      expect(result.success).toBe(true);
      expect(result.data.subject.byType).toEqual({});
      expect(result.data.totalQuestions).toBe(1);
      expect(questionsBuilder.eq).toHaveBeenCalledWith('created_by', 'test-user-id');
    });

    it('skips the bank lookup when there are no questions', async () => {
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(qb([{ id: 'fc-1' }]));

      const result = await service.getTeacherStats(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        totalQuestions: 0,
        totalFlashcards: 1,
        subject: { byType: {}, problematicQuestions: [] },
        bySubject: [],
      });
      expect(mock.from).toHaveBeenCalledTimes(2);
      expect(mock.from).not.toHaveBeenCalledWith('question_banks');
    });

    it('returns the problematic questions from the RPC (#204)', async () => {
      const problematic = [
        {
          id: 'q-1',
          content: 'Który rok uważa się za datę chrztu Polski?',
          type: 'mcq',
          correctRate: 0.4,
          totalAnswers: 5,
        },
      ];
      mock.rpc.mockResolvedValue({ data: problematic, error: null });
      mock.from.mockReturnValueOnce(qb([{ id: 'q-1', type: 'mcq', bank_id: 'bank-1' }]));
      mock.from.mockReturnValueOnce(qb([{ id: 'fc-1' }]));
      mock.from.mockReturnValueOnce(qb([{ id: 'bank-1', name: 'Historia' }]));

      const result = await service.getTeacherStats(ctx);

      expect(result.success).toBe(true);
      expect(result.data.subject.problematicQuestions).toEqual(problematic);
      // No active org: the RPC scopes learners to every org the caller shares.
      expect(mock.rpc).toHaveBeenCalledWith('get_teacher_problematic_questions', {
        p_user_id: 'test-user-id',
        p_organization_id: null,
        p_bank_id: null,
      });
    });

    it('passes the active org and the normalized bank id to the RPC', async () => {
      const orgCtx: RequestContext = { ...ctx, activeOrgId: 'org-1' };
      mock.from.mockReturnValueOnce(qb([{ id: 'q-1', type: 'mcq', bank_id: 'bank-his' }]));
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(qb([{ id: 'bank-his', name: 'Historia' }]));

      await service.getTeacherStats(orgCtx, { subjectId: 'BANK-HIS' });

      expect(mock.rpc).toHaveBeenCalledWith('get_teacher_problematic_questions', {
        p_user_id: 'test-user-id',
        p_organization_id: 'org-1',
        p_bank_id: 'bank-his',
      });
    });

    it('returns a failure when the problematic-questions RPC fails', async () => {
      mock.rpc.mockResolvedValue({ data: null, error: { message: 'boom', code: 'XX000' } });
      mock.from.mockReturnValueOnce(qb([{ id: 'q-1', type: 'mcq', bank_id: 'bank-1' }]));
      mock.from.mockReturnValueOnce(qb([{ id: 'fc-1' }]));
      mock.from.mockReturnValueOnce(qb([{ id: 'bank-1', name: 'Historia' }]));

      const result = await service.getTeacherStats(ctx);

      expect(result.success).toBe(false);
      expect(result.error).toBe('INTERNAL_SERVER');
    });

    it('falls back to an empty list when the RPC returns null', async () => {
      mock.rpc.mockResolvedValue({ data: null, error: null });
      mock.from.mockReturnValueOnce(qb([]));
      mock.from.mockReturnValueOnce(qb([{ id: 'fc-1' }]));

      const result = await service.getTeacherStats(ctx);

      expect(result.success).toBe(true);
      expect(result.data.subject.problematicQuestions).toEqual([]);
    });
  });

  describe('getStudentStats', () => {
    it('returns student stats with attempts and practice', async () => {
      const attempts = [
        { score: 8, total_questions: 10, started_at: '2024-01-01', config: {} },
        { score: 6, total_questions: 10, started_at: '2024-01-02', config: {} },
      ];
      const practice = [
        { was_correct: true, practiced_at: '2024-01-01' },
        { was_correct: false, practiced_at: '2024-01-02' },
      ];

      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: attempts, error: null }),
          }),
        }),
      });

      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: practice, error: null }),
          }),
        }),
      });

      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [{ id: 'q-1' }], error: null }),
        }),
      });

      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [], count: 0, error: null }),
        }),
      });

      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [], count: 0, error: null }),
        }),
      });

      mock.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            lte: vi.fn().mockResolvedValue({ data: [], count: 0, error: null }),
          }),
        }),
      });

      const result = await service.getStudentStats(ctx);

      expect(result.success).toBe(true);
      expect(result.data.totalQuizzes).toBe(2);
      expect(result.data.avgScore).toBe(70);
      expect(result.data.bestScore).toBe(80);
      expect(result.data.totalQuestionsCreated).toBe(1);
      expect(result.data.flashcardsPracticed).toBe(2);
      expect(result.data.flashcardAccuracy).toBe(50);
      expect(result.data.attemptsOverTime.length).toBe(2);
    });

    it('uses total_points as the denominator for assignment attempts (#167)', async () => {
      const attemptsBuilder = qb([
        {
          score: 3,
          total_questions: 4,
          total_points: 5,
          started_at: '2024-01-01',
          config: {},
        },
      ]);

      mock.from
        .mockReturnValueOnce(attemptsBuilder) // quiz_attempts
        .mockReturnValueOnce(qb([])) // flashcard_practice
        .mockReturnValueOnce(qb([])) // questions
        .mockReturnValueOnce(qb([], null, 0)) // flashcard_decks
        .mockReturnValueOnce(qb([], null, 0)) // flashcards
        .mockReturnValueOnce(qb([], null, 0)); // flashcard_review_state

      const result = await service.getStudentStats(ctx);

      expect(result.success).toBe(true);
      expect(result.data.avgScore).toBe(60);
      expect(result.data.bestScore).toBe(60);
      expect(result.data.attemptsOverTime[0]).toEqual({
        date: '2024-01-01',
        score: 3,
        total: 5,
        percentage: 60,
      });
    });

    it('returns zero stats when no data exists', async () => {
      const c: any = {};
      c.select = vi.fn(() => c);
      c.eq = vi.fn(() => c);
      c.order = vi.fn(() => c);
      c.lte = vi.fn(() => c);
      c.then = (onfulfilled: any) => Promise.resolve({ data: [], error: null }).then(onfulfilled);
      mock.from.mockReturnValue(c);

      const result = await service.getStudentStats(ctx);

      expect(result.success).toBe(true);
      expect(result.data.totalQuizzes).toBe(0);
      expect(result.data.avgScore).toBe(0);
      expect(result.data.bestScore).toBe(0);
      expect(result.data.flashcardsPracticed).toBe(0);
      expect(result.data.flashcardAccuracy).toBe(0);
    });

    it('scopes content counts to the active organization, but not activity logs', async () => {
      const orgCtx: RequestContext = { ...ctx, activeOrgId: 'org-1' };
      const attemptsBuilder = qb([]);
      const practiceBuilder = qb([]);
      const questionsBuilder = qb([{ id: 'q-1' }]);
      const decksBuilder = qb([], null, 0);
      const flashcardsBuilder = qb([], null, 0);
      const reviewStateBuilder = qb([], null, 0);
      mock.from.mockReturnValueOnce(attemptsBuilder);
      mock.from.mockReturnValueOnce(practiceBuilder);
      mock.from.mockReturnValueOnce(questionsBuilder);
      mock.from.mockReturnValueOnce(decksBuilder);
      mock.from.mockReturnValueOnce(flashcardsBuilder);
      mock.from.mockReturnValueOnce(reviewStateBuilder);

      const result = await service.getStudentStats(orgCtx);

      expect(result.success).toBe(true);
      expect(questionsBuilder.eq).toHaveBeenCalledWith('organization_id', 'org-1');
      expect(decksBuilder.eq).toHaveBeenCalledWith('organization_id', 'org-1');
      expect(flashcardsBuilder.eq).toHaveBeenCalledWith('organization_id', 'org-1');
      expect(attemptsBuilder.eq).not.toHaveBeenCalledWith('organization_id', 'org-1');
      expect(practiceBuilder.eq).not.toHaveBeenCalledWith('organization_id', 'org-1');
      expect(reviewStateBuilder.eq).not.toHaveBeenCalledWith('organization_id', 'org-1');
    });
  });

  describe('getTeacherQuizStats', () => {
    const orgCtx: RequestContext = {
      ...ctx,
      accountType: AccountType.EDUCATOR,
      activeOrgId: 'org-1',
      orgRoleId: 'role-1',
    };

    it('returns an empty list without an active organization and never queries the DB', async () => {
      const result = await service.getTeacherQuizStats({
        ...orgCtx,
        activeOrgId: null,
        orgRoleId: null,
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
      expect(mock.from).not.toHaveBeenCalled();
    });

    it('returns an empty list when the org membership was not verified', async () => {
      // active_org_id is a client-controlled cookie; withAuth only sets
      // orgRoleId once it confirmed the caller belongs to that org.
      const result = await service.getTeacherQuizStats({ ...orgCtx, orgRoleId: null });

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
      expect(mock.from).not.toHaveBeenCalled();
    });

    it('returns an empty list when the org has no student members', async () => {
      const membersBuilder = qb([{ user_id: 'teacher-1' }]);
      // Simulate the DB applying the `member` role filter: no rows survive.
      membersBuilder.eq.mockImplementation((column: string) =>
        column === 'org_roles.name' ? qb([]) : membersBuilder,
      );
      mock.from.mockReturnValueOnce(membersBuilder);

      const result = await service.getTeacherQuizStats(orgCtx);

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
      expect(mock.from).toHaveBeenCalledTimes(1);
      expect(mock.from).toHaveBeenCalledWith('org_members');
    });

    it('aggregates only completed attempts of the org students', async () => {
      const membersBuilder = qb([{ user_id: 's-1' }]);
      const attemptsBuilder = qb([
        { id: 'a-1', score: 8, total_questions: 10, config: { title: 'Quiz A' } },
        { id: 'a-2', score: 6, total_questions: 10, config: { title: 'Quiz A' } },
        { id: 'a-3', score: 5, total_questions: 20, config: { title: 'Quiz B' } },
        { id: 'a-4', score: 0, total_questions: 4, config: null },
      ]);
      mock.from.mockReturnValueOnce(membersBuilder);
      mock.from.mockReturnValueOnce(attemptsBuilder);

      const result = await service.getTeacherQuizStats(orgCtx);

      expect(membersBuilder.eq).toHaveBeenCalledWith('organization_id', 'org-1');
      expect(membersBuilder.eq).toHaveBeenCalledWith('org_roles.name', 'member');
      expect(attemptsBuilder.in).toHaveBeenCalledWith('user_id', ['s-1']);
      // Assignment attempts are included: each attempt is normalised to its own
      // percentage, so points and correct-answer counts are comparable (#203).
      expect(attemptsBuilder.is).not.toHaveBeenCalled();
      expect(attemptsBuilder.not).toHaveBeenCalledWith('completed_at', 'is', null);

      expect(result.success).toBe(true);
      expect(result.data).toEqual([
        {
          id: 'Quiz A',
          title: 'Quiz A',
          totalAttempts: 2,
          avgScore: 70, // (80 + 60) / 2
          avgCompletionRate: 10,
        },
        {
          id: 'Quiz B',
          title: 'Quiz B',
          totalAttempts: 1,
          avgScore: 25, // 5/20
          avgCompletionRate: 20,
        },
        {
          id: '',
          title: null,
          totalAttempts: 1,
          avgScore: 0, // 0/4
          avgCompletionRate: 4,
        },
      ]);
    });

    it('normalises assignment attempts by total_points and includes them (#203)', async () => {
      // The issue's EDU-ST-02 fixture: five completed assignment attempts scored
      // 3/4, 2/4, 4/4, 3/4, 3/4 → 75 %, not the raw mean of 3 points.
      const membersBuilder = qb([{ user_id: 's-1' }]);
      const attemptsBuilder = qb(
        [3, 2, 4, 3, 3].map((score, index) => ({
          id: `a-${index}`,
          score,
          total_questions: 4,
          total_points: 4,
          config: null,
        })),
      );
      mock.from.mockReturnValueOnce(membersBuilder);
      mock.from.mockReturnValueOnce(attemptsBuilder);

      const result = await service.getTeacherQuizStats(orgCtx);

      expect(result.success).toBe(true);
      expect(result.data).toEqual([
        {
          id: '',
          title: null,
          totalAttempts: 5,
          avgScore: 75,
          avgCompletionRate: 4,
        },
      ]);
    });

    it('guards a zero denominator', async () => {
      const membersBuilder = qb([{ user_id: 's-1' }]);
      const attemptsBuilder = qb([
        { id: 'a-1', score: 0, total_questions: 0, total_points: 0, config: null },
      ]);
      mock.from.mockReturnValueOnce(membersBuilder);
      mock.from.mockReturnValueOnce(attemptsBuilder);

      const result = await service.getTeacherQuizStats(orgCtx);

      expect(result.success).toBe(true);
      expect(result.data).toEqual([
        {
          id: '',
          title: null,
          totalAttempts: 1,
          avgScore: 0,
          avgCompletionRate: 0,
        },
      ]);
      expect(Number.isNaN(result.data?.[0]?.avgScore)).toBe(false);
    });

    it('returns a failure when the org members query fails', async () => {
      mock.from.mockReturnValueOnce(qb(null, { message: 'boom', code: 'XX000' }));

      const result = await service.getTeacherQuizStats(orgCtx);

      expect(result.success).toBe(false);
    });

    it('returns a failure when the quiz attempts query fails', async () => {
      mock.from.mockReturnValueOnce(qb([{ user_id: 's-1' }]));
      mock.from.mockReturnValueOnce(qb(null, { message: 'boom', code: 'XX000' }));

      const result = await service.getTeacherQuizStats(orgCtx);

      expect(result.success).toBe(false);
    });
  });
});
