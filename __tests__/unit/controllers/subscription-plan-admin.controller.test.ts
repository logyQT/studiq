import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SubscriptionPlanAdminController } from '@/server/controllers/subscription-plan-admin.controller';

function createMockService() {
  return {
    getAllAdmin: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
}

let mockService: ReturnType<typeof createMockService>;
let controller: SubscriptionPlanAdminController;

describe('SubscriptionPlanAdminController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockService();
    controller = new SubscriptionPlanAdminController(mockService as any);
  });

  describe('getAll', () => {
    it('returns all plans', async () => {
      mockService.getAllAdmin.mockResolvedValueOnce({ success: true, data: [] });
      const response = await controller.getAll();
      expect(response.success).toBe(true);
    });
    it('returns error on failure', async () => {
      mockService.getAllAdmin.mockResolvedValueOnce({ success: false, error: 'INTERNAL_SERVER' });
      const response = await controller.getAll();
      expect(response.success).toBe(false);
    });
  });

  describe('getById', () => {
    it('returns plan by id', async () => {
      mockService.getById.mockResolvedValueOnce({ success: true, data: { id: 'p-1' } });
      const response = await controller.getById('550e8400-e29b-41d4-a716-446655440000');
      expect(response.success).toBe(true);
    });
    it('returns 400 on invalid id', async () => {
      const response = await controller.getById('invalid');
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(400);
    });
    it('returns error on service failure', async () => {
      mockService.getById.mockResolvedValueOnce({ success: false, error: 'NOT_FOUND' });
      const response = await controller.getById('550e8400-e29b-41d4-a716-446655440000');
      expect(response.success).toBe(false);
    });
  });

  describe('create', () => {
    it('creates a plan', async () => {
      mockService.create.mockResolvedValueOnce({ success: true, data: { id: 'p-1' } });
      const response = await controller.create({ key: 'new', name: 'New' });
      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(201);
    });
    it('returns 422 on invalid body', async () => {
      const response = await controller.create({ key: '', name: '' });
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });
  });

  describe('update', () => {
    it('updates a plan', async () => {
      mockService.update.mockResolvedValueOnce({ success: true, data: { id: 'p-1' } });
      const response = await controller.update('550e8400-e29b-41d4-a716-446655440000', { name: 'Updated' });
      expect(response.success).toBe(true);
    });
    it('returns 400 on invalid id', async () => {
      const response = await controller.update('invalid', { name: 'Updated' });
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(400);
    });
  });

  describe('delete', () => {
    it('deletes a plan', async () => {
      mockService.delete.mockResolvedValueOnce({ success: true });
      const response = await controller.delete('550e8400-e29b-41d4-a716-446655440000');
      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
    });
    it('returns 400 on invalid id', async () => {
      const response = await controller.delete('invalid');
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(400);
    });
  });
});
