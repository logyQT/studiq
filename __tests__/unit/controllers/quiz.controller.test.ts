import type { RequestContext } from '@studiq/authz';
import { QuizController } from '@studiq/server/controllers/quiz.controller';
import { failure, success } from '@studiq/server/lib/service-result';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function createMockQuizService() {
  return {
    generateQuiz: vi.fn(),
  };
}

const mockCtx: RequestContext = {
  traceId: 'test-trace',
  userId: 'test-user-id',
  accountType: 'student',
  orgRoleId: null,
  activeOrgId: null,
  url: '/test',
  method: 'GET',
  groupIds: [],
  permissionScopes: {},
};

describe('QuizController', () => {
  let mockService: ReturnType<typeof createMockQuizService>;
  let controller: QuizController;

  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockQuizService();
    controller = new QuizController(mockService as any);
  });

  describe('generate', () => {
    it('returns success when service generates successfully', async () => {
      const body = { questionTypes: ['mcq'], questionCount: 10 };
      const result = { id: 'attempt-1', questions: [] };
      mockService.generateQuiz.mockResolvedValueOnce(success(result));

      const response = await controller.generate(body, mockCtx);

      expect(response).toEqual({ success: true, statusCode: 201, data: result });
    });

    it('returns UNPROCESSABLE_ENTITY when body fails validation', async () => {
      const response = await controller.generate({ questionTypes: [], questionCount: 0 }, mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect((response as any).error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('returns error when service returns failure', async () => {
      mockService.generateQuiz.mockResolvedValueOnce(failure('NOT_FOUND'));

      const response = await controller.generate(
        { questionTypes: ['mcq'], questionCount: 10 },
        mockCtx,
      );

      expect(response).toEqual({ success: false, statusCode: 404, error: 'NOT_FOUND' });
    });

    it('returns FORBIDDEN when service returns FORBIDDEN', async () => {
      mockService.generateQuiz.mockResolvedValueOnce(failure('FORBIDDEN'));

      const response = await controller.generate(
        { questionTypes: ['mcq'], questionCount: 10 },
        mockCtx,
      );

      expect(response).toEqual({ success: false, statusCode: 403, error: 'FORBIDDEN' });
    });
  });
});
