import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/errors';
import { flashcardTopicController } from '@/server/controllers/flashcard-topic.controller';
import { flashcardTopicService } from '@/server/services';

vi.mock('@/server/services', () => ({
  flashcardTopicService: {
    create: vi.fn(),
    list: vi.fn(),
    getById: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockService = vi.mocked(flashcardTopicService);

const mockCtx = {
  userId: 'test-user-id',
  organizationId: null,
  role: 'student' as const,
  url: 'http://localhost',
  method: 'GET',
};

describe('FlashcardTopicController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('returns success when service creates successfully', async () => {
      const body = { name: 'Math Topics' };
      const created = { id: 't-1', name: 'Math Topics' };
      mockService.create.mockResolvedValueOnce(created);

      const response = await flashcardTopicController.create(body, mockCtx);

      expect(response).toEqual({ success: true, statusCode: 201, data: created });
    });

    it('returns UNPROCESSABLE_ENTITY when body fails validation', async () => {
      const response = await flashcardTopicController.create({ name: '' }, mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect((response as any).error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('returns error when service throws AppError', async () => {
      mockService.create.mockRejectedValueOnce(new AppError('INTERNAL_SERVER'));

      const response = await flashcardTopicController.create({ name: 'Math Topics' }, mockCtx);

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });

    it('returns INTERNAL_SERVER when service throws generic error', async () => {
      mockService.create.mockRejectedValueOnce(new Error('unexpected'));

      const response = await flashcardTopicController.create({ name: 'Math Topics' }, mockCtx);

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });
  });

  describe('list', () => {
    it('returns topics for user', async () => {
      const topics = [{ id: 't-1', name: 'Math Topics' }];
      mockService.list.mockResolvedValueOnce(topics);

      const response = await flashcardTopicController.list(mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data: topics });
    });

    it('returns error when service throws', async () => {
      mockService.list.mockRejectedValueOnce(new AppError('INTERNAL_SERVER'));

      const response = await flashcardTopicController.list(mockCtx);

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });

    it('returns INTERNAL_SERVER when service throws generic error', async () => {
      mockService.list.mockRejectedValueOnce(new Error('unexpected'));

      const response = await flashcardTopicController.list(mockCtx);

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });
  });

  describe('getById', () => {
    it('returns topic when found', async () => {
      const topic = { id: 't-1', name: 'Math Topics' };
      mockService.getById.mockResolvedValueOnce(topic);

      const response = await flashcardTopicController.getById('t-1', mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data: topic });
    });

    it('returns NOT_FOUND when service throws', async () => {
      mockService.getById.mockRejectedValueOnce(new AppError('NOT_FOUND'));

      const response = await flashcardTopicController.getById('nonexistent', mockCtx);

      expect(response).toEqual({ success: false, statusCode: 404, error: 'NOT_FOUND' });
    });

    it('returns INTERNAL_SERVER when service throws generic error', async () => {
      mockService.getById.mockRejectedValueOnce(new Error('unexpected'));

      const response = await flashcardTopicController.getById('t-1', mockCtx);

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });
  });

  describe('update', () => {
    it('returns success when service updates successfully', async () => {
      const updated = { id: 't-1', name: 'Updated' };
      mockService.update.mockResolvedValueOnce(updated);

      const response = await flashcardTopicController.update('t-1', { name: 'Updated' }, mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data: updated });
    });

    it('returns UNPROCESSABLE_ENTITY when body fails validation', async () => {
      const response = await flashcardTopicController.update('t-1', { name: '' }, mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect((response as any).error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('returns FORBIDDEN when service throws FORBIDDEN', async () => {
      mockService.update.mockRejectedValueOnce(new AppError('FORBIDDEN'));

      const response = await flashcardTopicController.update('t-1', { name: 'Updated' }, mockCtx);

      expect(response).toEqual({ success: false, statusCode: 403, error: 'FORBIDDEN' });
    });

    it('returns INTERNAL_SERVER when service throws generic error', async () => {
      mockService.update.mockRejectedValueOnce(new Error('unexpected'));

      const response = await flashcardTopicController.update('t-1', { name: 'Updated' }, mockCtx);

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });
  });

  describe('delete', () => {
    it('returns success when service deletes successfully', async () => {
      mockService.delete.mockResolvedValueOnce(undefined);

      const response = await flashcardTopicController.delete('t-1', mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data: { success: true } });
    });

    it('returns error when service throws', async () => {
      mockService.delete.mockRejectedValueOnce(new AppError('FORBIDDEN'));

      const response = await flashcardTopicController.delete('t-1', mockCtx);

      expect(response).toEqual({ success: false, statusCode: 403, error: 'FORBIDDEN' });
    });

    it('returns INTERNAL_SERVER when service throws generic error', async () => {
      mockService.delete.mockRejectedValueOnce(new Error('unexpected'));

      const response = await flashcardTopicController.delete('t-1', mockCtx);

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });
  });
});
