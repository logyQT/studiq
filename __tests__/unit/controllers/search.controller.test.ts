import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchController } from '@/server/controllers/search.controller';
import type { RequestContext } from '@/lib/request-context';

function createMockService() {
  return { search: vi.fn() };
}

let mockService: ReturnType<typeof createMockService>;
let controller: SearchController;

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

describe('SearchController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockService();
    controller = new SearchController(mockService as any);
  });

  describe('search', () => {
    it('returns search results', async () => {
      mockService.search.mockResolvedValueOnce({ success: true, data: [] });

      const response = await controller.search({ q: 'flashcard' }, mockCtx);

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
    });

    it('returns 422 on invalid body', async () => {
      const response = await controller.search({ q: '' }, mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });

    it('returns error on service failure', async () => {
      mockService.search.mockResolvedValueOnce({ success: false, error: 'INTERNAL_SERVER' });

      const response = await controller.search({ q: 'test' }, mockCtx);

      expect(response.success).toBe(false);
    });
  });
});
