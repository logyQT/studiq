import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flashcardController } from './flashcard.controller';
import { flashcardService } from '@/server/services';
import { AppError } from '@/lib/errors';

vi.mock('@/server/services', () => ({
  flashcardService: {
    create: vi.fn(),
    list: vi.fn(),
    bulkCreate: vi.fn(),
    getById: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    link: vi.fn(),
    copy: vi.fn(),
  },
}));

const mockService = vi.mocked(flashcardService);

const mockCtx = {
  userId: 'test-user-id',
  universityId: null,
  role: 'student' as const,
  url: 'http://localhost',
  method: 'GET',
};

describe('FlashcardController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('returns success when service creates successfully', async () => {
      const body = { front: 'Q', back: 'A' };
      const created = { id: 'fc-1', ...body };
      mockService.create.mockResolvedValueOnce(created);

      const response = await flashcardController.create(body, mockCtx);

      expect(response).toEqual({ success: true, statusCode: 201, data: created });
    });

    it('returns UNPROCESSABLE_ENTITY when body fails validation', async () => {
      const response = await flashcardController.create({ front: '', back: 'A' }, mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect((response as any).error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('returns error when service throws AppError', async () => {
      mockService.create.mockRejectedValueOnce(new AppError('INTERNAL_SERVER'));

      const response = await flashcardController.create({ front: 'Q', back: 'A' }, mockCtx);

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });
  });

  describe('list', () => {
    it('returns flashcards with context', async () => {
      const flashcards = [{ id: 'fc-1', front: 'Q', back: 'A' }];
      mockService.list.mockResolvedValueOnce(flashcards);

      const response = await flashcardController.list(mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data: flashcards });
      expect(mockService.list).toHaveBeenCalledWith(mockCtx, undefined);
    });

    it('passes filters and context to service', async () => {
      mockService.list.mockResolvedValueOnce([]);

      await flashcardController.list(mockCtx, { topicIds: ['t-1'], deckIds: ['d-1'] });

      expect(mockService.list).toHaveBeenCalledWith(mockCtx, {
        topicIds: ['t-1'],
        deckIds: ['d-1'],
      });
    });

    it('returns INTERNAL_SERVER when service throws generic error', async () => {
      mockService.list.mockRejectedValueOnce(new Error('unexpected'));

      const response = await flashcardController.list(mockCtx);

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });
  });

  describe('bulkCreate', () => {
    it('returns success when service bulk creates successfully', async () => {
      const body = { cards: [{ front: 'Q1', back: 'A1' }] };
      const created = [{ id: 'fc-1', front: 'Q1', back: 'A1' }];
      mockService.bulkCreate.mockResolvedValueOnce(created);

      const response = await flashcardController.bulkCreate(body, mockCtx);

      expect(response).toEqual({ success: true, statusCode: 201, data: created });
    });

    it('returns UNPROCESSABLE_ENTITY when body fails validation', async () => {
      const response = await flashcardController.bulkCreate({ cards: [] }, mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect((response as any).error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('returns INTERNAL_SERVER when service throws generic error', async () => {
      mockService.bulkCreate.mockRejectedValueOnce(new Error('unexpected'));

      const response = await flashcardController.bulkCreate(
        { cards: [{ front: 'Q', back: 'A' }] },
        mockCtx,
      );

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });
  });

  describe('getById', () => {
    it('returns flashcard when found', async () => {
      const flashcard = { id: 'fc-1', front: 'Q', back: 'A' };
      mockService.getById.mockResolvedValueOnce(flashcard);

      const response = await flashcardController.getById('fc-1', mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data: flashcard });
      expect(mockService.getById).toHaveBeenCalledWith('fc-1', mockCtx);
    });

    it('returns NOT_FOUND when service throws', async () => {
      mockService.getById.mockRejectedValueOnce(new AppError('NOT_FOUND'));

      const response = await flashcardController.getById('nonexistent', mockCtx);

      expect(response).toEqual({ success: false, statusCode: 404, error: 'NOT_FOUND' });
    });

    it('returns INTERNAL_SERVER when service throws generic error', async () => {
      mockService.getById.mockRejectedValueOnce(new Error('unexpected'));

      const response = await flashcardController.getById('fc-1', mockCtx);

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });
  });

  describe('update', () => {
    it('returns success when service updates successfully', async () => {
      const updated = { id: 'fc-1', front: 'Updated' };
      mockService.update.mockResolvedValueOnce(updated);

      const response = await flashcardController.update('fc-1', { front: 'Updated' }, mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data: updated });
    });

    it('returns UNPROCESSABLE_ENTITY when body fails validation', async () => {
      const response = await flashcardController.update('fc-1', { front: '' }, mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect((response as any).error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('returns FORBIDDEN when service throws FORBIDDEN', async () => {
      mockService.update.mockRejectedValueOnce(new AppError('FORBIDDEN'));

      const response = await flashcardController.update('fc-1', { front: 'Updated' }, mockCtx);

      expect(response).toEqual({ success: false, statusCode: 403, error: 'FORBIDDEN' });
    });

    it('returns INTERNAL_SERVER when service throws generic error', async () => {
      mockService.update.mockRejectedValueOnce(new Error('unexpected'));

      const response = await flashcardController.update('fc-1', { front: 'Updated' }, mockCtx);

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });
  });

  describe('delete', () => {
    it('returns success when service deletes successfully', async () => {
      mockService.delete.mockResolvedValueOnce(undefined);

      const response = await flashcardController.delete('fc-1', mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data: { success: true } });
    });

    it('returns error when service throws', async () => {
      mockService.delete.mockRejectedValueOnce(new AppError('FORBIDDEN'));

      const response = await flashcardController.delete('fc-1', mockCtx);

      expect(response).toEqual({ success: false, statusCode: 403, error: 'FORBIDDEN' });
    });

    it('returns INTERNAL_SERVER when service throws generic error', async () => {
      mockService.delete.mockRejectedValueOnce(new Error('unexpected'));

      const response = await flashcardController.delete('fc-1', mockCtx);

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });
  });
});
