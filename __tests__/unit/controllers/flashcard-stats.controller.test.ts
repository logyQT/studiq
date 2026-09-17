import { RequestContext } from '@studiq/authz';
import { FlashcardStatsController } from '@studiq/server/controllers/flashcard-stats.controller';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function createMockService() {
  return {
    getTeacherStats: vi.fn(),
    getDifficultyCards: vi.fn(),
  };
}

let mockService: ReturnType<typeof createMockService>;
let controller: FlashcardStatsController;

const mockCtx: RequestContext = {
  traceId: 'test-trace',
  userId: 'test-user-id',
  accountType: 'educator' as any,
  orgRoleId: null,
  activeOrgId: 'org-1',
  url: 'http://localhost',
  method: 'GET',
  groupIds: [],
  permissionScopes: {},
};

describe('FlashcardStatsController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockService();
    controller = new FlashcardStatsController(mockService as any);
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
});
