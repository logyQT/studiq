import { RequestContext } from '@studiq/authz';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FlashcardExportController } from '@/server/controllers/flashcard-export.controller';

function createMockService() {
  return { exportCsv: vi.fn() };
}

let mockService: ReturnType<typeof createMockService>;
let controller: FlashcardExportController;

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

describe('FlashcardExportController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockService();
    controller = new FlashcardExportController(mockService as any);
  });

  describe('exportCsv', () => {
    it('exports CSV successfully', async () => {
      mockService.exportCsv.mockResolvedValueOnce({ success: true, data: { csv: 'front,back' } });

      const response = await controller.exportCsv({}, mockCtx);

      expect(response.success).toBe(true);
    });

    it('filters by deckId', async () => {
      mockService.exportCsv.mockResolvedValueOnce({ success: true, data: { csv: '' } });

      await controller.exportCsv({ deckId: '550e8400-e29b-41d4-a716-446655440000' }, mockCtx);

      expect(mockService.exportCsv).toHaveBeenCalledWith(mockCtx, {
        deckIds: ['550e8400-e29b-41d4-a716-446655440000'],
      });
    });

    it('filters by ids', async () => {
      mockService.exportCsv.mockResolvedValueOnce({ success: true, data: { csv: '' } });

      await controller.exportCsv({ ids: 'id1,id2' }, mockCtx);

      expect(mockService.exportCsv).toHaveBeenCalledWith(mockCtx, { ids: ['id1', 'id2'] });
    });

    it('returns error on service failure', async () => {
      mockService.exportCsv.mockResolvedValueOnce({ success: false, error: 'INTERNAL_SERVER' });

      const response = await controller.exportCsv({}, mockCtx);

      expect(response.success).toBe(false);
    });
  });
});
