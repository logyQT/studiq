import { describe, it, expect, vi, beforeEach } from 'vitest';
import { questionController } from './question.controller';
import { questionService } from '@/server/services';
import { AppError } from '@/lib/errors';

vi.mock('@/server/services', () => ({
  questionService: {
    create: vi.fn(),
    list: vi.fn(),
    getById: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockService = vi.mocked(questionService);

describe('QuestionController', () => {
  const userId = 'test-user-id';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('returns success when service creates successfully', async () => {
      const body = {
        type: 'mcq',
        content: 'What is 2+2?',
        answers: [{ content: '4', isCorrect: true }],
      };
      const created = { id: 'q-1', ...body };
      mockService.create.mockResolvedValueOnce(created);

      const response = await questionController.create(body, userId);

      expect(response).toEqual({ success: true, statusCode: 201, data: created });
    });

    it('returns UNPROCESSABLE_ENTITY when body fails validation', async () => {
      const response = await questionController.create({ type: 'mcq', content: '' }, userId);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect((response as any).error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('returns error when service throws AppError', async () => {
      mockService.create.mockRejectedValueOnce(new AppError('INTERNAL_SERVER'));

      const response = await questionController.create(
        { type: 'mcq', content: 'Q', answers: [{ content: 'A', isCorrect: true }] },
        userId,
      );

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });

    it('returns INTERNAL_SERVER when service throws unknown error', async () => {
      mockService.create.mockRejectedValueOnce(new Error('db error'));

      const response = await questionController.create(
        { type: 'mcq', content: 'Q', answers: [{ content: 'A', isCorrect: true }] },
        userId,
      );

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });
  });

  describe('list', () => {
    it('returns questions without filters', async () => {
      const questions = [{ id: 'q-1', content: 'Q1' }];
      mockService.list.mockResolvedValueOnce(questions);

      const response = await questionController.list();

      expect(response).toEqual({ success: true, statusCode: 200, data: questions });
    });

    it('passes filters to service', async () => {
      mockService.list.mockResolvedValueOnce([]);

      await questionController.list({ subjectId: 'sub-1', type: 'mcq', difficulty: 'easy' });

      expect(mockService.list).toHaveBeenCalledWith({
        subjectId: 'sub-1',
        type: 'mcq',
        difficulty: 'easy',
      });
    });

    it('returns INTERNAL_SERVER when service throws generic error', async () => {
      mockService.list.mockRejectedValueOnce(new Error('unexpected'));

      const response = await questionController.list();

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });
  });

  describe('getById', () => {
    it('returns question when found', async () => {
      const question = { id: 'q-1', content: 'Q1' };
      mockService.getById.mockResolvedValueOnce(question);

      const response = await questionController.getById('q-1');

      expect(response).toEqual({ success: true, statusCode: 200, data: question });
    });

    it('returns NOT_FOUND when service throws', async () => {
      mockService.getById.mockRejectedValueOnce(new AppError('NOT_FOUND'));

      const response = await questionController.getById('nonexistent');

      expect(response).toEqual({ success: false, statusCode: 404, error: 'NOT_FOUND' });
    });

    it('returns INTERNAL_SERVER when service throws generic error', async () => {
      mockService.getById.mockRejectedValueOnce(new Error('unexpected'));

      const response = await questionController.getById('q-1');

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });
  });

  describe('update', () => {
    it('returns success when service updates successfully', async () => {
      const updated = { id: 'q-1', content: 'Updated' };
      mockService.update.mockResolvedValueOnce(updated);

      const response = await questionController.update('q-1', { content: 'Updated' }, userId);

      expect(response).toEqual({ success: true, statusCode: 200, data: updated });
    });

    it('returns UNPROCESSABLE_ENTITY when body fails validation', async () => {
      const response = await questionController.update('q-1', { content: '' }, userId);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect((response as any).error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('returns FORBIDDEN when service throws FORBIDDEN', async () => {
      mockService.update.mockRejectedValueOnce(new AppError('FORBIDDEN'));

      const response = await questionController.update('q-1', { content: 'Updated' }, userId);

      expect(response).toEqual({ success: false, statusCode: 403, error: 'FORBIDDEN' });
    });

    it('returns INTERNAL_SERVER when service throws generic error', async () => {
      mockService.update.mockRejectedValueOnce(new Error('unexpected'));

      const response = await questionController.update('q-1', { content: 'Updated' }, userId);

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });
  });

  describe('delete', () => {
    it('returns success when service deletes successfully', async () => {
      mockService.delete.mockResolvedValueOnce(undefined);

      const response = await questionController.delete('q-1', userId);

      expect(response).toEqual({ success: true, statusCode: 200, data: { success: true } });
    });

    it('returns error when service throws', async () => {
      mockService.delete.mockRejectedValueOnce(new AppError('FORBIDDEN'));

      const response = await questionController.delete('q-1', userId);

      expect(response).toEqual({ success: false, statusCode: 403, error: 'FORBIDDEN' });
    });

    it('returns INTERNAL_SERVER when service throws generic error', async () => {
      mockService.delete.mockRejectedValueOnce(new Error('unexpected'));

      const response = await questionController.delete('q-1', userId);

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });
  });
});
