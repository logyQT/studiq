import { RequestContext } from '@studiq/authz';
import { ClassroomController } from '@studiq/server/controllers/classroom.controller';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function createMockService() {
  return { create: vi.fn() };
}

let mockService: ReturnType<typeof createMockService>;
let controller: ClassroomController;

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

describe('ClassroomController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockService();
    controller = new ClassroomController(mockService as any);
  });

  describe('create', () => {
    it('creates a classroom', async () => {
      mockService.create.mockResolvedValueOnce({
        success: true,
        data: { id: 'org-1', name: 'Class 1' },
      });

      const response = await controller.create(mockCtx, { name: 'Class 1' });

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(201);
    });

    it('returns 422 on invalid body', async () => {
      const response = await controller.create(mockCtx, { name: '' });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });

    it('returns error on service failure', async () => {
      mockService.create.mockResolvedValueOnce({ success: false, error: 'INTERNAL_SERVER' });

      const response = await controller.create(mockCtx, { name: 'Class 1' });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(500);
    });
  });
});
