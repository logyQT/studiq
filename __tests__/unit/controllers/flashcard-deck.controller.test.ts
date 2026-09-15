import { RequestContext } from '@studiq/authz';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { failure, success } from '@/lib/service-result';
import { FlashcardDeckController } from '@/server/controllers/flashcard-deck.controller';

function createMockService() {
  return { create: vi.fn(), list: vi.fn(), getById: vi.fn(), update: vi.fn(), delete: vi.fn() };
}

let mockService: ReturnType<typeof createMockService>;
let controller: FlashcardDeckController;

const mockCtx: RequestContext = {
  traceId: 'test-trace',
  userId: 'test-user-id',
  accountType: 'student' as any,
  orgRoleId: null,
  activeOrgId: null,
  url: 'http://localhost',
  method: 'GET',
  groupIds: [],
  permissionScopes: {},
};

describe('FlashcardDeckController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockService();
    controller = new FlashcardDeckController(mockService as any);
  });

  describe('create', () => {
    it('returns success when service creates successfully', async () => {
      const body = { name: 'Study Deck' };
      const created = { id: 'd-1', name: 'Study Deck' };
      mockService.create.mockResolvedValueOnce(success(created));

      const response = await controller.create(body, mockCtx);

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(201);
      expect((response as any).data).toEqual(created);
    });

    it('returns UNPROCESSABLE_ENTITY when body fails validation', async () => {
      const response = await controller.create({ name: '' }, mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect((response as any).error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('returns error when service returns failure', async () => {
      mockService.create.mockResolvedValueOnce(failure('INTERNAL_SERVER'));

      const response = await controller.create({ name: 'Study Deck' }, mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(500);
      expect((response as any).error).toBe('INTERNAL_SERVER');
    });
  });

  describe('list', () => {
    it('returns decks for user', async () => {
      const decks = [{ id: 'd-1', name: 'Study Deck' }];
      mockService.list.mockResolvedValueOnce(success(decks));

      const response = await controller.list({}, mockCtx);

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
      expect((response as any).data).toEqual(decks);
    });

    it('returns error when service returns failure', async () => {
      mockService.list.mockResolvedValueOnce(failure('INTERNAL_SERVER'));

      const response = await controller.list({}, mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(500);
      expect((response as any).error).toBe('INTERNAL_SERVER');
    });
  });

  describe('getById', () => {
    it('returns deck when found', async () => {
      const deck = { id: 'd-1', name: 'Study Deck' };
      mockService.getById.mockResolvedValueOnce(success(deck));

      const response = await controller.getById('d-1', mockCtx);

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
      expect((response as any).data).toEqual(deck);
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

      const response = await controller.getById('d-1', mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(500);
      expect((response as any).error).toBe('INTERNAL_SERVER');
    });
  });

  describe('update', () => {
    it('returns success when service updates successfully', async () => {
      const updated = { id: 'd-1', name: 'Updated' };
      mockService.update.mockResolvedValueOnce(success(updated));

      const response = await controller.update('d-1', { name: 'Updated' }, mockCtx);

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
      expect((response as any).data).toEqual(updated);
    });

    it('returns UNPROCESSABLE_ENTITY when body fails validation', async () => {
      const response = await controller.update('d-1', { name: '' }, mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect((response as any).error).toBe('UNPROCESSABLE_ENTITY');
    });

    it('returns FORBIDDEN when service returns failure', async () => {
      mockService.update.mockResolvedValueOnce(failure('FORBIDDEN'));

      const response = await controller.update('d-1', { name: 'Updated' }, mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(403);
      expect((response as any).error).toBe('FORBIDDEN');
    });

    it('returns error when service returns failure', async () => {
      mockService.update.mockResolvedValueOnce(failure('INTERNAL_SERVER'));

      const response = await controller.update('d-1', { name: 'Updated' }, mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(500);
      expect((response as any).error).toBe('INTERNAL_SERVER');
    });
  });

  describe('delete', () => {
    it('returns success when service deletes successfully', async () => {
      mockService.delete.mockResolvedValueOnce(success(undefined));

      const response = await controller.delete('d-1', mockCtx);

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
      expect((response as any).data).toEqual({ success: true });
    });

    it('returns error when service returns failure', async () => {
      mockService.delete.mockResolvedValueOnce(failure('FORBIDDEN'));

      const response = await controller.delete('d-1', mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(403);
      expect((response as any).error).toBe('FORBIDDEN');
    });

    it('returns error when service returns failure', async () => {
      mockService.delete.mockResolvedValueOnce(failure('INTERNAL_SERVER'));

      const response = await controller.delete('d-1', mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(500);
      expect((response as any).error).toBe('INTERNAL_SERVER');
    });
  });
});
