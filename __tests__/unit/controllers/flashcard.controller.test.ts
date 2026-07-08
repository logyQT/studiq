import { beforeEach, describe, expect, it, vi } from 'vitest';
import { success, failure } from '@/lib/service-result';
import { FlashcardController } from '@/server/controllers/flashcard.controller';
import type { RequestContext } from '@/lib/request-context';

function createMockService() {
  return { create: vi.fn(), list: vi.fn(), bulkCreate: vi.fn(), getById: vi.fn(), update: vi.fn(), delete: vi.fn() };
}

let mockService: ReturnType<typeof createMockService>;
let controller: FlashcardController;

const mockCtx: RequestContext = {
  traceId: 'test-trace',
  userId: 'test-user-id',
  accountType: 'student' as any,
  orgRoleId: null,
  activeOrgId: null,
  url: 'http://localhost',
  method: 'GET',
};

describe('FlashcardController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockService();
    controller = new FlashcardController(mockService as any);
  });

  describe('create', () => {
    const validDeckId = '550e8400-e29b-41d4-a716-446655440000';

    it('returns success when service creates successfully', async () => {
      const body = { front: 'Q', back: 'A', deckId: validDeckId };
      const created = { id: 'fc-1', ...body };
      mockService.create.mockResolvedValueOnce(success(created));

      const response = await controller.create(body, mockCtx);

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(201);
      expect((response as any).data).toEqual(created);
    });

    it('returns UNPROCESSABLE_ENTITY when body fails validation', async () => {
      const response = await controller.create({ front: '', back: 'A', deckId: validDeckId }, mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect((response as any).error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('returns error when service returns failure', async () => {
      mockService.create.mockResolvedValueOnce(failure('INTERNAL_SERVER'));

      const response = await controller.create({ front: 'Q', back: 'A', deckId: validDeckId }, mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(500);
      expect((response as any).error).toBe('INTERNAL_SERVER');
    });
  });

  describe('list', () => {
    it('returns flashcards with context', async () => {
      const flashcards = [{ id: 'fc-1', front: 'Q', back: 'A' }];
      mockService.list.mockResolvedValueOnce(success(flashcards));

      const response = await controller.list(mockCtx);

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
      expect((response as any).data).toEqual(flashcards);
      expect(mockService.list).toHaveBeenCalledWith(mockCtx, undefined);
    });

    it('passes filters and context to service', async () => {
      mockService.list.mockResolvedValueOnce(success([]));

      await controller.list(mockCtx, { topicIds: ['t-1'], deckIds: ['d-1'] });

      expect(mockService.list).toHaveBeenCalledWith(mockCtx, {
        topicIds: ['t-1'],
        deckIds: ['d-1'],
      });
    });

    it('returns error when service returns failure', async () => {
      mockService.list.mockResolvedValueOnce(failure('INTERNAL_SERVER'));

      const response = await controller.list(mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(500);
      expect((response as any).error).toBe('INTERNAL_SERVER');
    });
  });

  describe('bulkCreate', () => {
    const validDeckId = '550e8400-e29b-41d4-a716-446655440000';

    it('returns success when service bulk creates successfully', async () => {
      const body = { cards: [{ front: 'Q1', back: 'A1' }], deckIds: [validDeckId] };
      const created = [{ id: 'fc-1', front: 'Q1', back: 'A1' }];
      mockService.bulkCreate.mockResolvedValueOnce(success(created));

      const response = await controller.bulkCreate(body, mockCtx);

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(201);
      expect((response as any).data).toEqual(created);
    });

    it('returns UNPROCESSABLE_ENTITY when body fails validation', async () => {
      const response = await controller.bulkCreate({ cards: [] }, mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect((response as any).error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('returns error when service returns failure', async () => {
      mockService.bulkCreate.mockResolvedValueOnce(failure('INTERNAL_SERVER'));

      const response = await controller.bulkCreate(
        { cards: [{ front: 'Q', back: 'A' }], deckIds: [validDeckId] },
        mockCtx,
      );

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(500);
      expect((response as any).error).toBe('INTERNAL_SERVER');
    });
  });

  describe('getById', () => {
    it('returns flashcard when found', async () => {
      const flashcard = { id: 'fc-1', front: 'Q', back: 'A' };
      mockService.getById.mockResolvedValueOnce(success(flashcard));

      const response = await controller.getById('fc-1', mockCtx);

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
      expect((response as any).data).toEqual(flashcard);
      expect(mockService.getById).toHaveBeenCalledWith('fc-1', mockCtx);
    });

    it('returns NOT_FOUND when service returns failure', async () => {
      mockService.getById.mockResolvedValueOnce(failure('NOT_FOUND'));

      const response = await controller.getById('nonexistent', mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(404);
      expect((response as any).error).toBe('NOT_FOUND');
    });

    it('returns error when service returns failure', async () => {
      mockService.getById.mockResolvedValueOnce(failure('INTERNAL_SERVER'));

      const response = await controller.getById('fc-1', mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(500);
      expect((response as any).error).toBe('INTERNAL_SERVER');
    });
  });

  describe('update', () => {
    it('returns success when service updates successfully', async () => {
      const updated = { id: 'fc-1', front: 'Updated' };
      mockService.update.mockResolvedValueOnce(success(updated));

      const response = await controller.update('fc-1', { front: 'Updated' }, mockCtx);

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
      expect((response as any).data).toEqual(updated);
    });

    it('returns UNPROCESSABLE_ENTITY when body fails validation', async () => {
      const response = await controller.update('fc-1', { front: '' }, mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect((response as any).error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('returns FORBIDDEN when service returns failure', async () => {
      mockService.update.mockResolvedValueOnce(failure('FORBIDDEN'));

      const response = await controller.update('fc-1', { front: 'Updated' }, mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(403);
      expect((response as any).error).toBe('FORBIDDEN');
    });

    it('returns error when service returns failure', async () => {
      mockService.update.mockResolvedValueOnce(failure('INTERNAL_SERVER'));

      const response = await controller.update('fc-1', { front: 'Updated' }, mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(500);
      expect((response as any).error).toBe('INTERNAL_SERVER');
    });
  });

  describe('delete', () => {
    it('returns success when service deletes successfully', async () => {
      mockService.delete.mockResolvedValueOnce(success(undefined));

      const response = await controller.delete('fc-1', mockCtx);

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
      expect((response as any).data).toEqual({ success: true });
    });

    it('returns error when service returns failure', async () => {
      mockService.delete.mockResolvedValueOnce(failure('FORBIDDEN'));

      const response = await controller.delete('fc-1', mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(403);
      expect((response as any).error).toBe('FORBIDDEN');
    });

    it('returns error when service returns failure', async () => {
      mockService.delete.mockResolvedValueOnce(failure('INTERNAL_SERVER'));

      const response = await controller.delete('fc-1', mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(500);
      expect((response as any).error).toBe('INTERNAL_SERVER');
    });
  });
});
