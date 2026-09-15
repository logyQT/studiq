import { RequestContext } from '@studiq/authz';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';
import { QuizTeacherService } from '@/server/services/quiz-teacher.service';

function chain(result: any) {
  const resolved = { data: result, error: null };
  const terminal = vi.fn().mockResolvedValue(resolved);
  const c: any = {};
  c.select = vi.fn(() => c);
  c.eq = vi.fn(() => c);
  c.in = vi.fn(() => c);
  c.or = vi.fn(() => c);
  c.order = vi.fn(() => c);
  c.filter = vi.fn(() => c);
  c.limit = vi.fn(() => c);
  c.single = terminal;
  c.maybeSingle = terminal;
  c.insert = vi.fn(() => c);
  c.update = vi.fn(() => c);
  c.delete = vi.fn(() => c);
  c.upsert = vi.fn(() => c);
  c.then = (onfulfilled: any) => Promise.resolve(resolved).then(onfulfilled);
  return c;
}

function chainError(dbError: { message: string; code: string }) {
  const resolved = { data: null, error: dbError };
  const c: any = {};
  c.select = vi.fn(() => c);
  c.eq = vi.fn(() => c);
  c.insert = vi.fn(() => c);
  c.update = vi.fn(() => c);
  c.delete = vi.fn(() => c);
  c.then = (onfulfilled: any) => Promise.resolve(resolved).then(onfulfilled);
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
    service = new QuizTeacherService(async () => mock as any);
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
      mock.from.mockReturnValue(chain(dbRow));

      const result = await service.create({ name: 'My Quiz', description: 'A test quiz' }, ctx);

      expect(result.success).toBe(true);
    });
  });

  describe('list', () => {
    it('returns quizzes for the active org', async () => {
      const quizzes = [{ id: quizId, name: 'My Quiz' }];
      mock.from.mockReturnValue(chain(quizzes));

      const result = await service.list(ctx);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(quizzes);
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
      mock.from
        .mockReturnValueOnce(chain({ id: quizId, organization_id: orgId }))
        .mockReturnValue(chain({ id: quizId, name: 'Updated Name', organization_id: orgId }));

      const result = await service.update(
        quizId,
        { name: 'Updated Name', description: 'Updated desc' },
        ctx,
      );

      expect(result.success).toBe(true);
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
      mock.from
        .mockReturnValueOnce(chain({ id: quizId, organization_id: orgId }))
        .mockReturnValue(chain(null));

      const result = await service.delete(quizId, ctx);

      expect(result.success).toBe(true);
      expect(mock.from).toHaveBeenCalledWith('quizzes');
    });
  });

  describe('addQuestions', () => {
    it('adds questions to a quiz with sequential indices', async () => {
      mock.from
        .mockReturnValueOnce(chain({ id: quizId, organization_id: orgId }))
        .mockReturnValueOnce(chain(null))
        .mockReturnValueOnce(chain([]))
        .mockReturnValue(chain([{ question_id: 'q-1', order_index: 0, points: 1 }]));

      const result = await service.addQuestions(quizId, { questionIds: ['q-1'] }, ctx);

      expect(result.success).toBe(true);
    });

    it('skips duplicate questions', async () => {
      mock.from
        .mockReturnValueOnce(chain({ id: quizId, organization_id: orgId }))
        .mockReturnValueOnce(chain(null))
        .mockReturnValueOnce(chain([{ question_id: 'q-1' }]))
        .mockReturnValue(chain([]));

      const result = await service.addQuestions(quizId, { questionIds: ['q-1'] }, ctx);

      expect(result.success).toBe(true);
    });
  });

  describe('removeQuestion', () => {
    it('removes a question from a quiz', async () => {
      mock.from
        .mockReturnValueOnce(chain({ id: quizId, organization_id: orgId }))
        .mockReturnValue(chain(null));

      const result = await service.removeQuestion(quizId, 'q-1', ctx);

      expect(result.success).toBe(true);
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
      mock.from
        .mockReturnValueOnce(chain({ organization_id: orgId }))
        .mockReturnValueOnce(chain(null))
        .mockReturnValueOnce(chain(null))
        .mockReturnValue(chain(updated));

      const result = await service.bulkSave(quizId, { ...bulkData, questions: [] }, ctx);

      expect(result.success).toBe(true);
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
      mock.from
        .mockReturnValueOnce(chain({ organization_id: orgId }))
        .mockReturnValueOnce(chain(null))
        .mockReturnValueOnce(chain(null))
        .mockReturnValue(chain(null));

      const result = await service.reorderQuestions(
        quizId,
        { questionIds: ['q-1', 'q-2', 'q-3'] },
        ctx,
      );

      expect(result.success).toBe(true);
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
      mock.from
        .mockReturnValueOnce(chain(quiz))
        .mockReturnValueOnce(chain(createdAssignment))
        .mockReturnValue(chain(null));

      const result = await service.createAssignment(quizId, ctx);

      expect(result.success).toBe(true);
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
