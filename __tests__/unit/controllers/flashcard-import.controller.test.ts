import type { RequestContext } from '@studiq/authz';
import { FlashcardImportController } from '@studiq/server/controllers/flashcard-import.controller';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function createMockService() {
  return { importCsv: vi.fn() };
}

let mockService: ReturnType<typeof createMockService>;
let controller: FlashcardImportController;

const mockCtx: RequestContext = {
  traceId: 'test-trace',
  userId: 'test-user-id',
  accountType: 'student' as any,
  orgRoleId: null,
  activeOrgId: null,
  url: 'http://localhost',
  method: 'POST',
  groupIds: [],
  permissionScopes: {},
};

describe('FlashcardImportController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockService();
    controller = new FlashcardImportController(mockService as any);
  });

  describe('importCsv', () => {
    it('imports CSV successfully', async () => {
      mockService.importCsv.mockResolvedValueOnce({ success: true, data: { imported: 5 } });

      const response = await controller.importCsv(
        { cards: [{ front: 'Hello', back: 'Cześć' }] },
        mockCtx,
      );

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
    });

    it('returns 422 on invalid body', async () => {
      const response = await controller.importCsv({ cards: [] }, mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });

    it('returns error on service failure', async () => {
      mockService.importCsv.mockResolvedValueOnce({
        success: false,
        error: 'UNPROCESSABLE_ENTITY',
      });

      const response = await controller.importCsv(
        { cards: [{ front: 'Hello', back: 'Cześć' }] },
        mockCtx,
      );

      expect(response.success).toBe(false);
    });
  });
});
