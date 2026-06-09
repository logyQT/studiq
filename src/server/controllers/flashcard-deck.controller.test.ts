import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flashcardDeckController } from './flashcard-deck.controller';
import { flashcardDeckService } from '@/server/services';
import { AppError } from '@/lib/errors';

vi.mock('@/server/services', () => ({
  flashcardDeckService: {
    create: vi.fn(),
    list: vi.fn(),
    getById: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockService = vi.mocked(flashcardDeckService);

const mockCtx = {
  userId: 'test-user-id',
  universityId: null,
  role: 'student' as const,
  url: 'http://localhost',
  method: 'GET',
};

describe('FlashcardDeckController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('returns success when service creates successfully', async () => {
      const body = { name: 'Study Deck' };
      const created = { id: 'd-1', name: 'Study Deck' };
      mockService.create.mockResolvedValueOnce(created);

      const response = await flashcardDeckController.create(body, mockCtx);

      expect(response).toEqual({ success: true, statusCode: 201, data: created });
    });

    it('returns UNPROCESSABLE_ENTITY when body fails validation', async () => {
      const response = await flashcardDeckController.create({ name: '' }, mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect((response as any).error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('returns error when service throws AppError', async () => {
      mockService.create.mockRejectedValueOnce(new AppError('INTERNAL_SERVER'));

      const response = await flashcardDeckController.create({ name: 'Study Deck' }, mockCtx);

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });

    it('returns INTERNAL_SERVER when service throws generic error', async () => {
      mockService.create.mockRejectedValueOnce(new Error('unexpected'));

      const response = await flashcardDeckController.create({ name: 'Study Deck' }, mockCtx);

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });
  });

  describe('list', () => {
    it('returns decks for user', async () => {
      const decks = [{ id: 'd-1', name: 'Study Deck' }];
      mockService.list.mockResolvedValueOnce(decks);

      const response = await flashcardDeckController.list(mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data: decks });
    });

    it('returns error when service throws', async () => {
      mockService.list.mockRejectedValueOnce(new AppError('INTERNAL_SERVER'));

      const response = await flashcardDeckController.list(mockCtx);

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });

    it('returns INTERNAL_SERVER when service throws generic error', async () => {
      mockService.list.mockRejectedValueOnce(new Error('unexpected'));

      const response = await flashcardDeckController.list(mockCtx);

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });
  });

  describe('getById', () => {
    it('returns deck when found', async () => {
      const deck = { id: 'd-1', name: 'Study Deck' };
      mockService.getById.mockResolvedValueOnce(deck);

      const response = await flashcardDeckController.getById('d-1', mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data: deck });
    });

    it('returns NOT_FOUND when service throws', async () => {
      mockService.getById.mockRejectedValueOnce(new AppError('NOT_FOUND'));

      const response = await flashcardDeckController.getById('nonexistent', mockCtx);

      expect(response).toEqual({ success: false, statusCode: 404, error: 'NOT_FOUND' });
    });

    it('returns INTERNAL_SERVER when service throws generic error', async () => {
      mockService.getById.mockRejectedValueOnce(new Error('unexpected'));

      const response = await flashcardDeckController.getById('d-1', mockCtx);

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });
  });

  describe('update', () => {
    it('returns success when service updates successfully', async () => {
      const updated = { id: 'd-1', name: 'Updated' };
      mockService.update.mockResolvedValueOnce(updated);

      const response = await flashcardDeckController.update('d-1', { name: 'Updated' }, mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data: updated });
    });

    it('returns UNPROCESSABLE_ENTITY when body fails validation', async () => {
      const response = await flashcardDeckController.update('d-1', { name: '' }, mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect((response as any).error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('returns FORBIDDEN when service throws FORBIDDEN', async () => {
      mockService.update.mockRejectedValueOnce(new AppError('FORBIDDEN'));

      const response = await flashcardDeckController.update('d-1', { name: 'Updated' }, mockCtx);

      expect(response).toEqual({ success: false, statusCode: 403, error: 'FORBIDDEN' });
    });

    it('returns INTERNAL_SERVER when service throws generic error', async () => {
      mockService.update.mockRejectedValueOnce(new Error('unexpected'));

      const response = await flashcardDeckController.update('d-1', { name: 'Updated' }, mockCtx);

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });
  });

  describe('delete', () => {
    it('returns success when service deletes successfully', async () => {
      mockService.delete.mockResolvedValueOnce(undefined);

      const response = await flashcardDeckController.delete('d-1', mockCtx);

      expect(response).toEqual({ success: true, statusCode: 200, data: { success: true } });
    });

    it('returns error when service throws', async () => {
      mockService.delete.mockRejectedValueOnce(new AppError('FORBIDDEN'));

      const response = await flashcardDeckController.delete('d-1', mockCtx);

      expect(response).toEqual({ success: false, statusCode: 403, error: 'FORBIDDEN' });
    });

    it('returns INTERNAL_SERVER when service throws generic error', async () => {
      mockService.delete.mockRejectedValueOnce(new Error('unexpected'));

      const response = await flashcardDeckController.delete('d-1', mockCtx);

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });
  });
});
