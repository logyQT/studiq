import { beforeEach, describe, expect, it, vi } from 'vitest';
import { success, failure } from '@/lib/service-result';
import { TeacherAssignmentController } from '@/server/controllers/teacher-assignment.controller';
import type { RequestContext } from '@/lib/request-context';

function createMockService() {
  return {
    create: vi.fn(),
    list: vi.fn(),
    getById: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    publish: vi.fn(),
    addQuestions: vi.fn(),
    removeQuestion: vi.fn(),
    randomize: vi.fn(),
    setTargets: vi.fn(),
    getResults: vi.fn(),
    getStudentAnswers: vi.fn(),
    gradeAnswer: vi.fn(),
    listForStudent: vi.fn(),
    getForStudent: vi.fn(),
    startAttempt: vi.fn(),
    uploadImage: vi.fn(),
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

describe('TeacherAssignmentController', () => {
  let mockService: ReturnType<typeof createMockService>;
  let controller: TeacherAssignmentController;

  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockService();
    controller = new TeacherAssignmentController(mockService as any);
  });

  describe('create', () => {
    const validBody = { title: 'Quiz 1' };

    it('returns 201 when service creates successfully', async () => {
      const created = { id: 'a-1', title: 'Quiz 1' };
      mockService.create.mockResolvedValueOnce(success(created));

      const response = await controller.create(validBody, mockCtx);

      expect(response).toEqual({ success: true, statusCode: 201, data: created });
    });

    it('returns 422 when body fails validation', async () => {
      const response = await controller.create({ title: '' }, mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect((response as any).error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('returns error when service returns failure', async () => {
      mockService.create.mockResolvedValueOnce(failure('INTERNAL_SERVER'));

      const response = await controller.create(validBody, mockCtx);

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });
  });

  describe('list', () => {
    it('returns 200 with data', async () => {
      const data = [{ id: 'a-1', title: 'Quiz' }];
      mockService.list.mockResolvedValueOnce(success(data));

      const response = await controller.list(mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data });
    });

    it('returns error when service fails', async () => {
      mockService.list.mockResolvedValueOnce(failure('FORBIDDEN'));

      const response = await controller.list(mockCtx);

      expect(response).toEqual({ success: false, statusCode: 403, error: 'FORBIDDEN' });
    });
  });

  describe('getById', () => {
    it('returns 200 with assignment', async () => {
      const assignment = { id: 'a-1', title: 'Quiz' };
      mockService.getById.mockResolvedValueOnce(success(assignment));

      const response = await controller.getById('a-1', mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data: assignment });
    });

    it('returns NOT_FOUND when service returns failure', async () => {
      mockService.getById.mockResolvedValueOnce(failure('NOT_FOUND'));

      const response = await controller.getById('nonexistent', mockCtx);

      expect(response).toEqual({ success: false, statusCode: 404, error: 'NOT_FOUND' });
    });
  });

  describe('update', () => {
    it('returns 200 when service updates', async () => {
      const updated = { id: 'a-1', title: 'Updated' };
      mockService.update.mockResolvedValueOnce(success(updated));

      const response = await controller.update('a-1', { title: 'Updated' }, mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data: updated });
    });

    it('returns 422 when body fails validation', async () => {
      const response = await controller.update('a-1', { title: '' }, mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect((response as any).error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('returns NOT_FOUND when service returns failure', async () => {
      mockService.update.mockResolvedValueOnce(failure('NOT_FOUND'));

      const response = await controller.update('nonexistent', { title: 'Updated' }, mockCtx);

      expect(response).toEqual({ success: false, statusCode: 404, error: 'NOT_FOUND' });
    });
  });

  describe('delete', () => {
    it('returns 200 when service deletes', async () => {
      mockService.delete.mockResolvedValueOnce(success(null));

      const response = await controller.delete('a-1', mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data: null });
    });

    it('returns NOT_FOUND when service fails', async () => {
      mockService.delete.mockResolvedValueOnce(failure('NOT_FOUND'));

      const response = await controller.delete('nonexistent', mockCtx);

      expect(response).toEqual({ success: false, statusCode: 404, error: 'NOT_FOUND' });
    });
  });

  describe('publish', () => {
    it('returns 200 when service publishes', async () => {
      const published = { id: 'a-1', status: 'published' };
      mockService.publish.mockResolvedValueOnce(success(published));

      const response = await controller.publish('a-1', {}, mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data: published });
    });

    it('returns 422 when body is invalid', async () => {
      const response = await controller.publish('a-1', { deadline: 'bad-date' }, mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });
  });

  describe('addQuestions', () => {
    it('returns 200 when questions added', async () => {
      mockService.addQuestions.mockResolvedValueOnce(success({ added: 2 }));

      const response = await controller.addQuestions('a-1', { questionIds: ['550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440002'] }, mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data: { added: 2 } });
    });

    it('returns 422 with empty questionIds', async () => {
      const response = await controller.addQuestions('a-1', { questionIds: [] }, mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect((response as any).error).toBe('UNPROCESSABLE_ENTITY');
    });
  });

  describe('removeQuestion', () => {
    it('returns 200 when question removed', async () => {
      mockService.removeQuestion.mockResolvedValueOnce(success(null));

      const response = await controller.removeQuestion('a-1', 'q-1', mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data: null });
    });
  });

  describe('randomize', () => {
    it('returns 200 when questions randomized', async () => {
      mockService.randomize.mockResolvedValueOnce(success({ added: 5 }));

      const response = await controller.randomize('a-1', { source: 'all', count: 5 }, mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data: { added: 5 } });
    });

    it('returns 422 with invalid source', async () => {
      const response = await controller.randomize('a-1', { source: 'invalid', count: 5 }, mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });
  });

  describe('setTargets', () => {
    it('returns 200 when targets set', async () => {
      mockService.setTargets.mockResolvedValueOnce(success(null));

      const response = await controller.setTargets('a-1', { groupIds: ['550e8400-e29b-41d4-a716-446655440000'] }, mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data: null });
    });
  });

  describe('getResults', () => {
    it('returns 200 with results', async () => {
      const results = [{ id: 'att-1', user_id: 's-1', score: 8 }];
      mockService.getResults.mockResolvedValueOnce(success(results));

      const response = await controller.getResults('a-1', mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data: results });
    });
  });

  describe('getStudentAnswers', () => {
    it('returns 200 with student answers', async () => {
      const data = { id: 'att-1', quiz_answers: [] };
      mockService.getStudentAnswers.mockResolvedValueOnce(success(data));

      const response = await controller.getStudentAnswers('a-1', 's-1', mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data });
    });
  });

  describe('gradeAnswer', () => {
    it('returns 200 when graded', async () => {
      mockService.gradeAnswer.mockResolvedValueOnce(success(null));

      const response = await controller.gradeAnswer('a-1', 's-1', { questionId: '550e8400-e29b-41d4-a716-446655440000', points: 5 }, mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data: null });
    });

    it('returns 422 with negative points', async () => {
      const response = await controller.gradeAnswer('a-1', 's-1', { questionId: '550e8400-e29b-41d4-a716-446655440000', points: -1 }, mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });
  });

  describe('listForStudent', () => {
    it('returns 200 with assignments', async () => {
      const data = [{ id: 'a-1', title: 'Quiz', attempt: null }];
      mockService.listForStudent.mockResolvedValueOnce(success(data));

      const response = await controller.listForStudent(mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data });
    });
  });

  describe('getForStudent', () => {
    it('returns 200 with assignment', async () => {
      const data = { id: 'a-1', title: 'Quiz' };
      mockService.getForStudent.mockResolvedValueOnce(success(data));

      const response = await controller.getForStudent('a-1', mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data });
    });
  });

  describe('startAttempt', () => {
    it('returns 200 with attempt data', async () => {
      const data = { id: 'att-1', questions: [] };
      mockService.startAttempt.mockResolvedValueOnce(success(data));

      const response = await controller.startAttempt('a-1', mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data });
    });

    it('returns RATE_LIMITED when service fails', async () => {
      mockService.startAttempt.mockResolvedValueOnce(failure('RATE_LIMITED'));

      const response = await controller.startAttempt('a-1', mockCtx);

      expect(response).toEqual({ success: false, statusCode: 429, error: 'RATE_LIMITED' });
    });
  });

  describe('uploadImage', () => {
    it('returns 200 when image uploaded', async () => {
      mockService.uploadImage.mockResolvedValueOnce(success(null));

      const response = await controller.uploadImage('a-1', 'att-1', 'q-1', 'https://img.url', mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data: null });
    });

    it('returns FORBIDDEN when service fails', async () => {
      mockService.uploadImage.mockResolvedValueOnce(failure('FORBIDDEN'));

      const response = await controller.uploadImage('a-1', 'att-1', 'q-1', 'https://img.url', mockCtx);

      expect(response).toEqual({ success: false, statusCode: 403, error: 'FORBIDDEN' });
    });
  });
});
