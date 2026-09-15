import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestContext } from '@/lib/request-context';
import { SeatController } from '@/server/controllers/seat.controller';

function createMockService() {
  return {
    listPools: vi.fn(),
    addPool: vi.fn(),
    updatePool: vi.fn(),
    listAssignments: vi.fn(),
    assignSeat: vi.fn(),
    unassignSeat: vi.fn(),
  };
}

let mockService: ReturnType<typeof createMockService>;
let controller: SeatController;
const mockCtx: RequestContext = {
  traceId: 'test',
  userId: 'u-1',
  accountType: 'educator' as any,
  orgRoleId: null,
  activeOrgId: 'org-1',
  url: '',
  method: 'GET',
  groupIds: [],
  permissionScopes: {},
};

describe('SeatController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockService();
    controller = new SeatController(mockService as any);
  });

  describe('listPools', () => {
    it('returns pools', async () => {
      mockService.listPools.mockResolvedValueOnce({ success: true, data: [] });
      const response = await controller.listPools(mockCtx);
      expect(response.success).toBe(true);
    });
    it('returns error on failure', async () => {
      mockService.listPools.mockResolvedValueOnce({ success: false, error: 'INTERNAL_SERVER' });
      const response = await controller.listPools(mockCtx);
      expect(response.success).toBe(false);
    });
  });

  describe('createPool', () => {
    it('creates a pool and returns 201', async () => {
      mockService.addPool.mockResolvedValueOnce({
        success: true,
        data: { id: 'p-1', planKey: 'ace', total: 10, assigned: 0 },
      });
      const response = await controller.createPool(mockCtx, {
        planKey: 'ace',
        quantity: 10,
      });
      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(201);
    });
    it('returns 422 on invalid body', async () => {
      const response = await controller.createPool(mockCtx, { planKey: '' });
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });
  });

  describe('updatePool', () => {
    it('updates a pool', async () => {
      mockService.updatePool.mockResolvedValueOnce({ success: true, data: { id: 'p-1' } });
      const response = await controller.updatePool(mockCtx, 'pool-1', { total: 10 });
      expect(response.success).toBe(true);
    });
    it('returns 422 on invalid body', async () => {
      const response = await controller.updatePool(mockCtx, 'pool-1', { capacity: -1 });
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });
  });

  describe('listAssignments', () => {
    it('returns assignments', async () => {
      mockService.listAssignments.mockResolvedValueOnce({ success: true, data: [] });
      const response = await controller.listAssignments(mockCtx);
      expect(response.success).toBe(true);
    });
  });

  describe('assignSeat', () => {
    it('assigns a seat', async () => {
      mockService.assignSeat.mockResolvedValueOnce({ success: true, data: { id: 'a-1' } });
      const response = await controller.assignSeat(mockCtx, {
        userId: '550e8400-e29b-41d4-a716-446655440000',
        poolId: '550e8400-e29b-41d4-a716-446655440001',
      });
      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(201);
    });
    it('returns 422 on invalid body', async () => {
      const response = await controller.assignSeat(mockCtx, { userId: 'bad' });
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });
  });

  describe('unassignSeat', () => {
    it('unassigns a seat', async () => {
      mockService.unassignSeat.mockResolvedValueOnce({ success: true, data: undefined });
      const response = await controller.unassignSeat(mockCtx, 'assignment-1');
      expect(response.success).toBe(true);
    });
    it('returns error on failure', async () => {
      mockService.unassignSeat.mockResolvedValueOnce({ success: false, error: 'NOT_FOUND' });
      const response = await controller.unassignSeat(mockCtx, 'nonexistent');
      expect(response.success).toBe(false);
    });
  });
});
