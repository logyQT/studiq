import type { RequestContext } from '@studiq/authz';
import { QuizTeacherService } from '@studiq/server/services/quiz-teacher.service';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

type ChainResult<T> = { data: T | null; error: { message: string; code: string } | null };

interface FakeQueryBuilder<T> {
  select: Mock;
  eq: Mock;
  in: Mock;
  or: Mock;
  order: Mock;
  filter: Mock;
  limit: Mock;
  single: Mock;
  maybeSingle: Mock;
  insert: Mock;
  update: Mock;
  delete: Mock;
  upsert: Mock;
  then: Promise<T>['then'];
}

function chain<T>(result: T): FakeQueryBuilder<ChainResult<T>> {
  const resolved: ChainResult<T> = { data: result, error: null };
  const promise = Promise.resolve(resolved);
  const terminal = vi.fn().mockResolvedValue(resolved);
  const c: FakeQueryBuilder<ChainResult<T>> = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    or: vi.fn(),
    order: vi.fn(),
    filter: vi.fn(),
    limit: vi.fn(),
    single: terminal,
    maybeSingle: terminal,
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    upsert: vi.fn(),
    then: promise.then.bind(promise),
  };
  for (const method of [
    c.select,
    c.eq,
    c.in,
    c.or,
    c.order,
    c.filter,
    c.limit,
    c.insert,
    c.update,
    c.delete,
    c.upsert,
  ]) {
    method.mockImplementation(() => c);
  }
  return c;
}

function chainError(dbError: { message: string; code: string }): FakeQueryBuilder<never> {
  const resolved = { data: null, error: dbError };
  const promise = Promise.resolve(resolved);
  const c: FakeQueryBuilder<never> = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    or: vi.fn(),
    order: vi.fn(),
    filter: vi.fn(),
    limit: vi.fn(),
    single: vi.fn().mockResolvedValue(resolved),
    maybeSingle: vi.fn().mockResolvedValue(resolved),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    upsert: vi.fn(),
    then: promise.then.bind(promise),
  };
  for (const method of [c.select, c.eq, c.insert, c.update, c.delete]) {
    method.mockImplementation(() => c);
  }
  return c;
}

const userId = 'user-1';
const orgId = 'org-1';
const quizId = 'quiz-1';

const ctx: RequestContext = {
  userId,
  accountType: 'teacher',
  traceId: 't',
  url: '',
  method: 'GET',
  activeOrgId: orgId,
  orgRoleId: 'role-id',
  groupIds: [],
  permissionScopes: {},
};

describe('QuizTeacherService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  let service: QuizTeacherService;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
    service = new QuizTeacherService(() => Promise.resolve(mock));
  });

  describe('create', () => {
    it('creates a quiz successfully', async () => {
      const dbRow = { id: quizId, name: 'My Quiz', organization_id: orgId };
      mock.from.mockReturnValue(chain(dbRow));

      const result = await service.create({ name: 'My Quiz' }, ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(dbRow);
      }
      expect(mock.from).toHaveBeenCalledWith('quizzes');
    });

    it('creates a quiz with description', async () => {
      const dbRow = {
        id: quizId,
        name: 'My Quiz',
        description: 'A test quiz',
        organization_id: orgId,
      };
      const createChain = chain(dbRow);
      mock.from.mockReturnValue(createChain);

      const result = await service.create({ name: 'My Quiz', description: 'A test quiz' }, ctx);

      expect(result.success).toBe(true);
      expect(createChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          organization_id: orgId,
          created_by: userId,
          name: 'My Quiz',
          description: 'A test quiz',
        }),
      );
    });

    it('returns FORBIDDEN without an active org and never queries (#148)', async () => {
      const result = await service.create({ name: 'My Quiz' }, { ...ctx, activeOrgId: null });

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('FORBIDDEN');
      expect(mock.from).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('returns quizzes for the active org', async () => {
      const quizzes = [{ id: quizId, name: 'My Quiz' }];
      mock.from.mockReturnValue(chain(quizzes));

      const result = await service.list(ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        // The card count is derived from the quiz's non-deleted items (#1171).
        expect(result.data).toEqual([{ ...quizzes[0], quiz_questions: [{ count: 0 }] }]);
      }
      expect(mock.from).toHaveBeenCalledWith('quizzes');
    });

    it('returns empty array when no quizzes exist', async () => {
      mock.from.mockReturnValue(chain(null));

      const result = await service.list(ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual([]);
      }
    });

    it('returns FORBIDDEN when there is no active organization', async () => {
      const result = await service.list({ ...ctx, activeOrgId: null });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('FORBIDDEN');
      }
      // The guard must short-circuit before any query: a null org used to reach
      // PostgREST as `organization_id=eq.null` and blew up with 22P02 -> 500.
      expect(mock.from).not.toHaveBeenCalled();
    });
  });

  describe('getById', () => {
    it('returns a quiz with questions', async () => {
      const dbRow = {
        id: quizId,
        name: 'My Quiz',
        organization_id: orgId,
        quiz_questions: [{ question_id: 'q-1', order_index: 0, points: 1 }],
      };
      mock.from.mockReturnValue(chain(dbRow));

      const result = await service.getById(quizId, ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(dbRow);
      }
    });

    it('returns NOT_FOUND when org does not match', async () => {
      const dbRow = { id: quizId, name: 'My Quiz', organization_id: 'other-org' };
      mock.from.mockReturnValue(chain(dbRow));

      const result = await service.getById(quizId, ctx);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('NOT_FOUND');
      }
    });

    it('returns NOT_FOUND when quiz does not exist', async () => {
      mock.from.mockReturnValue(chain(null));

      const result = await service.getById(quizId, ctx);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('NOT_FOUND');
      }
    });
  });

  describe('update', () => {
    it('updates quiz name and description', async () => {
      const updated = { id: quizId, name: 'Updated Name', organization_id: orgId };
      const updateChain = chain(updated);
      mock.from
        .mockReturnValueOnce(chain({ id: quizId, organization_id: orgId }))
        .mockReturnValue(updateChain);

      const result = await service.update(
        quizId,
        { name: 'Updated Name', description: 'Updated desc' },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(updateChain.update).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Updated Name', description: 'Updated desc' }),
      );
      expect(updateChain.eq).toHaveBeenCalledWith('id', quizId);
      if (result.success) expect(result.data).toEqual(updated);
    });

    it('returns NOT_FOUND for non-existent quiz', async () => {
      mock.from.mockReturnValue(chain(null));

      const result = await service.update(quizId, { name: 'New Name' }, ctx);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('NOT_FOUND');
      }
    });
  });

  describe('delete', () => {
    it('deletes a quiz', async () => {
      const deleteChain = chain(null);
      mock.from
        .mockReturnValueOnce(chain({ id: quizId, organization_id: orgId }))
        .mockReturnValue(deleteChain);

      const result = await service.delete(quizId, ctx);

      expect(result.success).toBe(true);
      expect(mock.from).toHaveBeenCalledWith('quizzes');
      expect(deleteChain.delete).toHaveBeenCalled();
      expect(deleteChain.eq).toHaveBeenCalledWith('id', quizId);
    });
  });

  describe('addQuestions', () => {
    it('adds questions to a quiz with sequential indices', async () => {
      const insertChain = chain([{ question_id: 'q-1', order_index: 5, points: 1 }]);
      mock.from
        .mockReturnValueOnce(chain({ id: quizId, organization_id: orgId }))
        .mockReturnValueOnce(chain({ order_index: 4 }))
        .mockReturnValueOnce(chain([]))
        .mockReturnValue(insertChain);

      const result = await service.addQuestions(quizId, { questionIds: ['q-1', 'q-2'] }, ctx);

      expect(result.success).toBe(true);
      // Sequential from the current max (4), never from zero.
      expect(insertChain.insert).toHaveBeenCalledWith([
        { quiz_id: quizId, question_id: 'q-1', order_index: 5, points: 1 },
        { quiz_id: quizId, question_id: 'q-2', order_index: 6, points: 1 },
      ]);
    });

    it('skips duplicate questions', async () => {
      const insertChain = chain([]);
      mock.from
        .mockReturnValueOnce(chain({ id: quizId, organization_id: orgId }))
        .mockReturnValueOnce(chain(null))
        .mockReturnValueOnce(chain([{ question_id: 'q-1' }]))
        .mockReturnValue(insertChain);

      const result = await service.addQuestions(quizId, { questionIds: ['q-1'] }, ctx);

      expect(result.success).toBe(true);
      expect(insertChain.insert).not.toHaveBeenCalled();
    });
  });

  describe('removeQuestion', () => {
    it('removes a question from a quiz', async () => {
      const deleteChain = chain(null);
      mock.from
        .mockReturnValueOnce(chain({ id: quizId, organization_id: orgId }))
        .mockReturnValue(deleteChain);

      const result = await service.removeQuestion(quizId, 'q-1', ctx);

      expect(result.success).toBe(true);
      expect(deleteChain.eq).toHaveBeenCalledWith('quiz_id', quizId);
      expect(deleteChain.eq).toHaveBeenCalledWith('question_id', 'q-1');
    });
  });

  describe('bulkSave', () => {
    const bulkData = {
      name: 'Updated Quiz',
      description: 'Updated desc',
      questions: [{ question_id: 'q-1', order_index: 0, points: 1 }],
    };

    it('saves quiz with questions successfully', async () => {
      const updated = {
        id: quizId,
        name: 'Updated Quiz',
        quiz_questions: [{ question_id: 'q-1' }],
      };
      mock.from
        .mockReturnValueOnce(chain({ organization_id: orgId }))
        .mockReturnValueOnce(chain(null))
        .mockReturnValueOnce(chain(null))
        .mockReturnValueOnce(chain(null))
        .mockReturnValue(chain(updated));

      const result = await service.bulkSave(quizId, bulkData, ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(updated);
      }
    });

    it('saves quiz with empty questions array', async () => {
      const updated = { id: quizId, name: 'Updated Quiz', quiz_questions: [] };
      const updateChain = chain(null);
      const deleteChain = chain(null);
      mock.from
        .mockReturnValueOnce(chain({ organization_id: orgId }))
        .mockReturnValueOnce(updateChain)
        .mockReturnValueOnce(deleteChain)
        .mockReturnValue(chain(updated));

      const result = await service.bulkSave(quizId, { ...bulkData, questions: [] }, ctx);

      expect(result.success).toBe(true);
      expect(updateChain.update).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Updated Quiz', description: 'Updated desc' }),
      );
      expect(deleteChain.eq).toHaveBeenCalledWith('quiz_id', quizId);
      // Access, update, delete, select — no fifth call, so nothing was inserted.
      expect(mock.from).toHaveBeenCalledTimes(4);
    });

    it('returns NOT_FOUND when quiz does not exist', async () => {
      mock.from.mockReturnValue(chain(null));

      const result = await service.bulkSave(quizId, bulkData, ctx);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('NOT_FOUND');
      }
    });

    it('returns FORBIDDEN when org does not match', async () => {
      mock.from.mockReturnValue(chain({ organization_id: 'other-org' }));

      const result = await service.bulkSave(quizId, bulkData, ctx);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('FORBIDDEN');
      }
    });

    it('returns error when update fails', async () => {
      mock.from
        .mockReturnValueOnce(chain({ organization_id: orgId }))
        .mockReturnValueOnce(chainError({ message: 'fail', code: 'XX000' }));

      const result = await service.bulkSave(quizId, bulkData, ctx);

      expect(result.success).toBe(false);
    });

    it('returns error when insert fails', async () => {
      mock.from
        .mockReturnValueOnce(chain({ organization_id: orgId }))
        .mockReturnValueOnce(chain(null))
        .mockReturnValueOnce(chain(null))
        .mockReturnValueOnce(chainError({ message: 'fail', code: 'XX000' }));

      const result = await service.bulkSave(quizId, bulkData, ctx);

      expect(result.success).toBe(false);
    });
  });

  describe('reorderQuestions', () => {
    it('reorders questions sequentially', async () => {
      const updateChain = chain(null);
      mock.from.mockReturnValueOnce(chain({ organization_id: orgId })).mockReturnValue(updateChain);

      const result = await service.reorderQuestions(
        quizId,
        { questionIds: ['q-1', 'q-2', 'q-3'] },
        ctx,
      );

      expect(result.success).toBe(true);
      expect(updateChain.update.mock.calls).toEqual([
        [{ order_index: 0 }],
        [{ order_index: 1 }],
        [{ order_index: 2 }],
      ]);
      expect(updateChain.eq.mock.calls).toEqual([
        ['quiz_id', quizId],
        ['question_id', 'q-1'],
        ['quiz_id', quizId],
        ['question_id', 'q-2'],
        ['quiz_id', quizId],
        ['question_id', 'q-3'],
      ]);
    });

    it('returns NOT_FOUND when quiz does not exist', async () => {
      mock.from.mockReturnValue(chain(null));

      const result = await service.reorderQuestions(quizId, { questionIds: ['q-1'] }, ctx);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('NOT_FOUND');
      }
    });

    it('returns NOT_FOUND when org does not match', async () => {
      mock.from.mockReturnValue(chain({ organization_id: 'other-org' }));

      const result = await service.reorderQuestions(quizId, { questionIds: ['q-1'] }, ctx);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('NOT_FOUND');
      }
    });

    it('returns error when update fails', async () => {
      mock.from
        .mockReturnValueOnce(chain({ organization_id: orgId }))
        .mockReturnValueOnce(chainError({ message: 'fail', code: 'XX000' }));

      const result = await service.reorderQuestions(quizId, { questionIds: ['q-1'] }, ctx);

      expect(result.success).toBe(false);
    });
  });

  describe('createAssignment', () => {
    it('creates an assignment and copies questions from quiz', async () => {
      const quiz = {
        id: quizId,
        name: 'My Quiz',
        organization_id: orgId,
        quiz_questions: [
          { question_id: 'q-1', order_index: 0, points: 1 },
          { question_id: 'q-2', order_index: 1, points: 2 },
        ],
      };
      const createdAssignment = { id: 'assign-1', title: 'My Quiz', quiz_id: quizId };
      const assignmentChain = chain(createdAssignment);
      const linksChain = chain(null);
      mock.from
        .mockReturnValueOnce(chain(quiz))
        .mockReturnValueOnce(chain([{ id: 'q-1' }, { id: 'q-2' }])) // every item is open
        .mockReturnValueOnce(assignmentChain)
        .mockReturnValue(linksChain);

      const result = await service.createAssignment(quizId, ctx);

      expect(result.success).toBe(true);
      expect(assignmentChain.insert).toHaveBeenCalledWith({
        organization_id: orgId,
        created_by: userId,
        title: 'My Quiz',
        quiz_id: quizId,
      });
      expect(linksChain.insert).toHaveBeenCalledWith([
        { assignment_id: 'assign-1', question_id: 'q-1', order_index: 0, points: 1 },
        { assignment_id: 'assign-1', question_id: 'q-2', order_index: 1, points: 2 },
      ]);
    });

    it('refuses a quiz copy when an item is no longer open (#1171)', async () => {
      const quiz = {
        id: quizId,
        name: 'My Quiz',
        organization_id: orgId,
        quiz_questions: [{ question_id: 'q-1', order_index: 0, points: 1 }],
      };
      mock.from
        .mockReturnValueOnce(chain(quiz))
        .mockReturnValueOnce(chain([])) // the retired item is not open
        .mockReturnValue(chain(null));

      const result = await service.createAssignment(quizId, ctx);

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe('UNPROCESSABLE_ENTITY');
      // Refused before anything was created.
      expect(mock.from).toHaveBeenCalledTimes(2);
    });

    it('returns FORBIDDEN when org does not match', async () => {
      const quiz = { id: quizId, name: 'My Quiz', organization_id: 'other-org' };
      mock.from.mockReturnValue(chain(quiz));

      const result = await service.createAssignment(quizId, ctx);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('FORBIDDEN');
      }
    });
  });
});
