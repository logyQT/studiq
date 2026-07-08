import { beforeEach, describe, expect, it, vi } from 'vitest';
import { success, failure } from '@/lib/service-result';
import { QuizAttemptController } from '@/server/controllers/quiz-attempt.controller';
import type { ControllerResponse } from '@/lib/controller-response';
import type { RequestContext } from '@/lib/request-context';

function createMockQuizAttemptService() {
  return {
    list: vi.fn(),
    getById: vi.fn(),
    submit: vi.fn(),
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
};

describe('QuizAttemptController', () => {
  let mockService: ReturnType<typeof createMockQuizAttemptService>;
  let controller: QuizAttemptController;

  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockQuizAttemptService();
    controller = new QuizAttemptController(mockService as any);
  });

  describe('list', () => {
    it('returns attempts when service succeeds', async () => {
      const attempts = [{ id: 'a-1', score: 5 }];
      mockService.list.mockResolvedValueOnce(success(attempts));

      const response = await controller.list(mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data: attempts });
    });

    it('returns error when service returns failure', async () => {
      mockService.list.mockResolvedValueOnce(failure('INTERNAL_SERVER'));

      const response = await controller.list(mockCtx);

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });
  });

  describe('getDetails', () => {
    it('returns attempt details when found', async () => {
      const attempt = { id: 'a-1', questions: [], answers: {} };
      mockService.getById.mockResolvedValueOnce(success(attempt));

      const response = await controller.getDetails('a-1', mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data: attempt });
    });

    it('returns NOT_FOUND when service returns failure', async () => {
      mockService.getById.mockResolvedValueOnce(failure('NOT_FOUND'));

      const response = await controller.getDetails('nonexistent', mockCtx);

      expect(response).toEqual({ success: false, statusCode: 404, error: 'NOT_FOUND' });
    });
  });

  describe('submit', () => {
    it('returns success when service submits successfully', async () => {
      const body = {
        answers: [
          {
            questionId: '550e8400-e29b-41d4-a716-446655440001',
            selectedAnswerId: '550e8400-e29b-41d4-a716-446655440002',
          },
        ],
      };
      const result = { score: 1, totalQuestions: 1 };
      mockService.submit.mockResolvedValueOnce(success(result));

      const response = await controller.submit(
        body,
        '550e8400-e29b-41d4-a716-446655440000',
        mockCtx,
      );

      expect(response).toEqual({ success: true, statusCode: 200, data: result });
    });

    it('returns UNPROCESSABLE_ENTITY when body fails validation', async () => {
      const response = await controller.submit(
        { answers: [{ questionId: 'not-a-uuid' }] },
        '550e8400-e29b-41d4-a716-446655440000',
        mockCtx,
      );

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect((response as any).error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('returns error when service returns failure', async () => {
      mockService.submit.mockResolvedValueOnce(failure('NOT_FOUND'));

      const response = await controller.submit(
        {
          answers: [{ questionId: '550e8400-e29b-41d4-a716-446655440001' }],
        },
        '550e8400-e29b-41d4-a716-446655440000',
        mockCtx,
      );

      expect(response).toEqual({ success: false, statusCode: 404, error: 'NOT_FOUND' });
    });
  });
});
