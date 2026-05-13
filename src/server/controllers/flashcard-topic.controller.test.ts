import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flashcardTopicController } from './flashcard-topic.controller';
import { flashcardTopicService } from '@/server/services';
import { AppError } from '@/lib/errors';

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

describe('FlashcardTopicController', () => {
  const userId = 'test-user-id';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('returns success when service creates successfully', async () => {
      const body = { name: 'Math Topics' };
      const created = { id: 't-1', name: 'Math Topics' };
      mockService.create.mockResolvedValueOnce(created);

      const response = await flashcardTopicController.create(body, userId);

      expect(response).toEqual({ success: true, statusCode: 201, data: created });
    });

    it('returns UNPROCESSABLE_ENTITY when body fails validation', async () => {
      const response = await flashcardTopicController.create({ name: '' }, userId);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect(response.error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('returns error when service throws AppError', async () => {
      mockService.create.mockRejectedValueOnce(new AppError('INTERNAL_SERVER'));

      const response = await flashcardTopicController.create({ name: 'Math Topics' }, userId);

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });
  });

  describe('list', () => {
    it('returns topics for user', async () => {
      const topics = [{ id: 't-1', name: 'Math Topics' }];
      mockService.list.mockResolvedValueOnce(topics);

      const response = await flashcardTopicController.list(userId);

      expect(response).toEqual({ success: true, statusCode: 200, data: topics });
    });

    it('returns error when service throws', async () => {
      mockService.list.mockRejectedValueOnce(new AppError('INTERNAL_SERVER'));

      const response = await flashcardTopicController.list(userId);

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });
  });

  describe('getById', () => {
    it('returns topic when found', async () => {
      const topic = { id: 't-1', name: 'Math Topics' };
      mockService.getById.mockResolvedValueOnce(topic);

      const response = await flashcardTopicController.getById('t-1');

      expect(response).toEqual({ success: true, statusCode: 200, data: topic });
    });

    it('returns NOT_FOUND when service throws', async () => {
      mockService.getById.mockRejectedValueOnce(new AppError('NOT_FOUND'));

      const response = await flashcardTopicController.getById('nonexistent');

      expect(response).toEqual({ success: false, statusCode: 404, error: 'NOT_FOUND' });
    });
  });

  describe('update', () => {
    it('returns success when service updates successfully', async () => {
      const updated = { id: 't-1', name: 'Updated' };
      mockService.update.mockResolvedValueOnce(updated);

      const response = await flashcardTopicController.update('t-1', { name: 'Updated' }, userId);

      expect(response).toEqual({ success: true, statusCode: 200, data: updated });
    });

    it('returns UNPROCESSABLE_ENTITY when body fails validation', async () => {
      const response = await flashcardTopicController.update('t-1', { name: '' }, userId);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect(response.error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('returns FORBIDDEN when service throws FORBIDDEN', async () => {
      mockService.update.mockRejectedValueOnce(new AppError('FORBIDDEN'));

      const response = await flashcardTopicController.update('t-1', { name: 'Updated' }, userId);

      expect(response).toEqual({ success: false, statusCode: 403, error: 'FORBIDDEN' });
    });
  });

  describe('delete', () => {
    it('returns success when service deletes successfully', async () => {
      mockService.delete.mockResolvedValueOnce(undefined);

      const response = await flashcardTopicController.delete('t-1', userId);

      expect(response).toEqual({ success: true, statusCode: 200, data: { success: true } });
    });

    it('returns error when service throws', async () => {
      mockService.delete.mockRejectedValueOnce(new AppError('FORBIDDEN'));

      const response = await flashcardTopicController.delete('t-1', userId);

      expect(response).toEqual({ success: false, statusCode: 403, error: 'FORBIDDEN' });
    });
  });
});
