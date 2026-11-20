import { AccountType, type RequestContext } from '@studiq/authz';
import { FlashcardStatsController } from '@studiq/server/controllers/flashcard-stats.controller';
import { FlashcardStatsService } from '@studiq/server/services/flashcard-stats.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { success } from '@studiq/server/lib/service-result';

function createMockService() {
  // The mocked methods never touch the database, so the client factory only
  // has to satisfy the constructor's type.
  return Object.assign(new FlashcardStatsService(() => Promise.reject(new Error('unused'))), {
    getTeacherStats: vi.fn(),
    getDifficultyCards: vi.fn(),
  });
}

let mockService: ReturnType<typeof createMockService>;
let controller: FlashcardStatsController;

const mockCtx: RequestContext = {
  traceId: 'test-trace',
  userId: 'test-user-id',
  accountType: AccountType.EDUCATOR,
  orgRoleId: null,
  activeOrgId: 'org-1',
  url: 'http://localhost',
  method: 'GET',
  groupIds: [],
  permissionScopes: { 'stats.read': 'group' },
};

describe('FlashcardStatsController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockService();
    // Only the two stats methods are exercised; nothing else is reached.
    controller = new FlashcardStatsController(mockService);
  });

  describe('getTeacherStats', () => {
    it('returns stats', async () => {
      mockService.getTeacherStats.mockResolvedValueOnce({
        success: true,
        data: { summary: { totalDecks: 0, totalFlashcards: 0 }, byDeck: [], byTopic: [] },
      });

      const response = await controller.getTeacherStats({}, mockCtx);

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
    });

    it('returns 422 on invalid query', async () => {
      const response = await controller.getTeacherStats({ deckId: 'not-a-uuid' }, mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });

    it('returns error on service failure', async () => {
      mockService.getTeacherStats.mockResolvedValueOnce({ success: false, error: 'FORBIDDEN' });

      const response = await controller.getTeacherStats({}, mockCtx);

      expect(response.success).toBe(false);
    });
  });

  describe('getDifficultyCards', () => {
    it('returns difficulty cards', async () => {
      mockService.getDifficultyCards.mockResolvedValueOnce({ success: true, data: [] });

      const response = await controller.getDifficultyCards({ bucket: 'easy' }, mockCtx);

      expect(response.success).toBe(true);
    });

    it('returns 422 on invalid bucket', async () => {
      const response = await controller.getDifficultyCards({ bucket: 'invalid' }, mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });

    it('returns error on service failure', async () => {
      mockService.getDifficultyCards.mockResolvedValueOnce({ success: false, error: 'FORBIDDEN' });

      const response = await controller.getDifficultyCards({ bucket: 'easy' }, mockCtx);

      expect(response.success).toBe(false);
    });
  });

  describe('permission gate (ADR-0015 §7, phase 2b-6)', () => {
    it('a caller without stats.read is 403 on both teacher reads', async () => {
      const ctx = { ...mockCtx, permissionScopes: {} };
      expect(await controller.getTeacherStats({}, ctx)).toEqual({
        success: false,
        statusCode: 403,
        error: 'FORBIDDEN',
      });
      expect(await controller.getDifficultyCards({ bucket: 'easy' }, ctx)).toEqual({
        success: false,
        statusCode: 403,
        error: 'FORBIDDEN',
      });
      expect(mockService.getTeacherStats).not.toHaveBeenCalled();
      expect(mockService.getDifficultyCards).not.toHaveBeenCalled();
    });

    it.each(['own', 'group', 'organization'] as const)(
      'a caller holding stats.read at %s scope is allowed',
      async (scope) => {
        mockService.getTeacherStats.mockResolvedValueOnce(success({ total: 1 }));
        const response = await controller.getTeacherStats(
          {},
          { ...mockCtx, permissionScopes: { 'stats.read': scope } },
        );
        expect(response).toEqual({ success: true, statusCode: 200, data: { total: 1 } });
      },
    );

    it('a student-persona holder of the key is allowed (D13)', async () => {
      mockService.getDifficultyCards.mockResolvedValueOnce(success([]));
      const response = await controller.getDifficultyCards(
        { bucket: 'easy' },
        { ...mockCtx, accountType: AccountType.STUDENT, permissionScopes: { 'stats.read': 'own' } },
      );
      expect(response).toEqual({ success: true, statusCode: 200, data: [] });
    });
  });
});
