import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flashcardSpaceController } from './flashcard-space.controller';
import { flashcardSpaceService } from '@/server/services';
import { AppError } from '@/lib/errors';

vi.mock('@/server/services', () => ({
  flashcardSpaceService: {
    create: vi.fn(),
    list: vi.fn(),
    getById: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockService = vi.mocked(flashcardSpaceService);

describe('FlashcardSpaceController', () => {
  const userId = 'test-user-id';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('returns success when service creates successfully', async () => {
      const body = { name: 'Study Space' };
      const created = { id: 's-1', name: 'Study Space' };
      mockService.create.mockResolvedValueOnce(created);

      const response = await flashcardSpaceController.create(body, userId);

      expect(response).toEqual({ success: true, statusCode: 201, data: created });
    });

    it('returns UNPROCESSABLE_ENTITY when body fails validation', async () => {
      const response = await flashcardSpaceController.create({ name: '' }, userId);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect((response as any).error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('returns error when service throws AppError', async () => {
      mockService.create.mockRejectedValueOnce(new AppError('INTERNAL_SERVER'));

      const response = await flashcardSpaceController.create({ name: 'Study Space' }, userId);

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });
  });

  describe('list', () => {
    it('returns spaces for user', async () => {
      const spaces = [{ id: 's-1', name: 'Study Space' }];
      mockService.list.mockResolvedValueOnce(spaces);

      const response = await flashcardSpaceController.list(userId);

      expect(response).toEqual({ success: true, statusCode: 200, data: spaces });
    });

    it('returns error when service throws', async () => {
      mockService.list.mockRejectedValueOnce(new AppError('INTERNAL_SERVER'));

      const response = await flashcardSpaceController.list(userId);

      expect(response).toEqual({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' });
    });
  });

  describe('getById', () => {
    it('returns space when found', async () => {
      const space = { id: 's-1', name: 'Study Space' };
      mockService.getById.mockResolvedValueOnce(space);

      const response = await flashcardSpaceController.getById('s-1', userId);

      expect(response).toEqual({ success: true, statusCode: 200, data: space });
    });

    it('returns NOT_FOUND when service throws', async () => {
      mockService.getById.mockRejectedValueOnce(new AppError('NOT_FOUND'));

      const response = await flashcardSpaceController.getById('nonexistent', userId);

      expect(response).toEqual({ success: false, statusCode: 404, error: 'NOT_FOUND' });
    });
  });

  describe('update', () => {
    it('returns success when service updates successfully', async () => {
      const updated = { id: 's-1', name: 'Updated' };
      mockService.update.mockResolvedValueOnce(updated);

      const response = await flashcardSpaceController.update('s-1', { name: 'Updated' }, userId);

      expect(response).toEqual({ success: true, statusCode: 200, data: updated });
    });

    it('returns UNPROCESSABLE_ENTITY when body fails validation', async () => {
      const response = await flashcardSpaceController.update('s-1', { name: '' }, userId);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect((response as any).error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('returns FORBIDDEN when service throws FORBIDDEN', async () => {
      mockService.update.mockRejectedValueOnce(new AppError('FORBIDDEN'));

      const response = await flashcardSpaceController.update('s-1', { name: 'Updated' }, userId);

      expect(response).toEqual({ success: false, statusCode: 403, error: 'FORBIDDEN' });
    });
  });

  describe('delete', () => {
    it('returns success when service deletes successfully', async () => {
      mockService.delete.mockResolvedValueOnce(undefined);

      const response = await flashcardSpaceController.delete('s-1', userId);

      expect(response).toEqual({ success: true, statusCode: 200, data: { success: true } });
    });

    it('returns error when service throws', async () => {
      mockService.delete.mockRejectedValueOnce(new AppError('FORBIDDEN'));

      const response = await flashcardSpaceController.delete('s-1', userId);

      expect(response).toEqual({ success: false, statusCode: 403, error: 'FORBIDDEN' });
    });
  });
});
