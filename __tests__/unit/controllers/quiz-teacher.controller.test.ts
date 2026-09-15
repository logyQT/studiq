import { RequestContext } from '@studiq/authz';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { failure, success } from '@/lib/service-result';
import { QuizTeacherController } from '@/server/controllers/quiz-teacher.controller';

function createMockService() {
  return {
    create: vi.fn(),
    list: vi.fn(),
    getById: vi.fn(),
    bulkSave: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    addQuestions: vi.fn(),
    removeQuestion: vi.fn(),
    reorderQuestions: vi.fn(),
    createAssignment: vi.fn(),
  };
}

const mockCtx: RequestContext = {
  traceId: 't',
  userId: 'teacher-1',
  accountType: 'teacher',
  orgRoleId: null,
  activeOrgId: 'org-1',
  url: '/test',
  method: 'GET',
  groupIds: [],
  permissionScopes: {},
};

describe('QuizTeacherController', () => {
  let mockService: ReturnType<typeof createMockService>;
  let controller: QuizTeacherController;

  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockService();
    controller = new QuizTeacherController(mockService as any);
  });

  describe('create', () => {
    it('returns 201 when service creates successfully', async () => {
      const created = { id: 'quiz-1', name: 'My Quiz' };
      mockService.create.mockResolvedValueOnce(success(created));

      const response = await controller.create({ name: 'My Quiz' }, mockCtx);

      expect(response).toEqual({ success: true, statusCode: 201, data: created });
    });

    it('returns 422 when name is missing', async () => {
      const response = await controller.create({}, mockCtx);

      expect(response.success).toBe(false);
      if (!response.success) {
        expect(response.statusCode).toBe(422);
        expect(response.error).toBe('UNPROCESSABLE_ENTITY');
      }
    });

    it('returns error when service fails', async () => {
      mockService.create.mockResolvedValueOnce(failure('INTERNAL_SERVER'));

      const response = await controller.create({ name: 'My Quiz' }, mockCtx);

      expect(response.success).toBe(false);
      if (!response.success) {
        expect(response.error).toBe('INTERNAL_SERVER');
      }
    });
  });

  describe('list', () => {
    it('returns quizzes list', async () => {
      const quizzes = [{ id: 'quiz-1', name: 'My Quiz' }];
      mockService.list.mockResolvedValueOnce(success(quizzes));

      const response = await controller.list(mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data: quizzes });
    });
  });

  describe('getById', () => {
    it('returns a single quiz', async () => {
      const quiz = { id: 'quiz-1', name: 'My Quiz' };
      mockService.getById.mockResolvedValueOnce(success(quiz));

      const response = await controller.getById('quiz-1', mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data: quiz });
    });
  });

  describe('bulkSave', () => {
    it('returns 200 when service saves successfully', async () => {
      const saved = { id: 'quiz-1', name: 'Updated Quiz', quiz_questions: [] };
      mockService.bulkSave.mockResolvedValueOnce(success(saved));

      const response = await controller.bulkSave(
        'quiz-1',
        { name: 'Updated Quiz', questions: [{ question_id: uuid, order_index: 0, points: 1 }] },
        mockCtx,
      );

      expect(response).toEqual({ success: true, statusCode: 200, data: saved });
    });

    it('returns 422 when name is missing', async () => {
      const response = await controller.bulkSave(
        'quiz-1',
        { questions: [{ question_id: uuid, order_index: 0, points: 1 }] },
        mockCtx,
      );

      expect(response.success).toBe(false);
      if (!response.success) {
        expect(response.statusCode).toBe(422);
        expect(response.error).toBe('UNPROCESSABLE_ENTITY');
      }
    });

    it('returns 422 when name is empty', async () => {
      const response = await controller.bulkSave('quiz-1', { name: '', questions: [] }, mockCtx);

      expect(response.success).toBe(false);
      if (!response.success) {
        expect(response.statusCode).toBe(422);
      }
    });

    it('propagates service error', async () => {
      mockService.bulkSave.mockResolvedValueOnce(failure('NOT_FOUND'));

      const response = await controller.bulkSave(
        'quiz-1',
        { name: 'Quiz', questions: [] },
        mockCtx,
      );

      expect(response.success).toBe(false);
      if (!response.success) {
        expect(response.statusCode).toBe(404);
        expect(response.error).toBe('NOT_FOUND');
      }
    });
  });

  describe('update', () => {
    it('updates quiz successfully', async () => {
      const updated = { id: 'quiz-1', name: 'Updated' };
      mockService.update.mockResolvedValueOnce(success(updated));

      const response = await controller.update('quiz-1', { name: 'Updated' }, mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data: updated });
    });
  });

  describe('delete', () => {
    it('deletes quiz successfully', async () => {
      mockService.delete.mockResolvedValueOnce(success(null));

      const response = await controller.delete('quiz-1', mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data: null });
    });
  });

  const uuid = '00000000-0000-4000-8000-000000000001';

  describe('addQuestions', () => {
    it('adds questions successfully', async () => {
      const added = [{ question_id: uuid, order_index: 0, points: 1 }];
      mockService.addQuestions.mockResolvedValueOnce(success(added));

      const response = await controller.addQuestions('quiz-1', { questionIds: [uuid] }, mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data: added });
    });

    it('returns 422 when questionIds is empty', async () => {
      const response = await controller.addQuestions('quiz-1', { questionIds: [] }, mockCtx);

      expect(response.success).toBe(false);
      if (!response.success) {
        expect(response.statusCode).toBe(422);
      }
    });
  });

  describe('removeQuestion', () => {
    it('removes a question successfully', async () => {
      mockService.removeQuestion.mockResolvedValueOnce(success(null));

      const response = await controller.removeQuestion('quiz-1', uuid, mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data: null });
    });
  });

  describe('reorderQuestions', () => {
    it('reorders questions successfully', async () => {
      mockService.reorderQuestions.mockResolvedValueOnce(success(null));

      const response = await controller.reorderQuestions(
        'quiz-1',
        { questionIds: [uuid] },
        mockCtx,
      );

      expect(response).toEqual({ success: true, statusCode: 200, data: null });
    });
  });

  describe('createAssignment', () => {
    it('creates assignment from quiz successfully', async () => {
      const assignment = { id: 'assign-1', title: 'My Quiz' };
      mockService.createAssignment.mockResolvedValueOnce(success(assignment));

      const response = await controller.createAssignment('quiz-1', mockCtx);

      expect(response).toEqual({ success: true, statusCode: 201, data: assignment });
    });
  });
});
