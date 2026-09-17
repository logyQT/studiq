import { PlanFeatureController } from '@studiq/server/controllers/plan-feature.controller';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function createMockService() {
  return {
    getAll: vi.fn(),
    getByPlanKey: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  };
}

let mockService: ReturnType<typeof createMockService>;
let controller: PlanFeatureController;

describe('PlanFeatureController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockService();
    controller = new PlanFeatureController(mockService as any);
  });

  describe('getAll', () => {
    it('returns all plan features', async () => {
      mockService.getAll.mockResolvedValueOnce({ success: true, data: [] });

      const response = await controller.getAll();

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
    });

    it('returns error on failure', async () => {
      mockService.getAll.mockResolvedValueOnce({ success: false, error: 'INTERNAL_SERVER' });

      const response = await controller.getAll();

      expect(response.success).toBe(false);
    });
  });

  describe('create', () => {
    it('creates a plan feature', async () => {
      const feature = { id: 'f-1', plan_key: 'base', feature_key: 'quiz' };
      mockService.create.mockResolvedValueOnce({ success: true, data: feature });

      const response = await controller.create({ planKey: 'base', featureKey: 'quiz' });

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(201);
    });

    it('returns 422 on invalid body', async () => {
      const response = await controller.create({ planKey: '', featureKey: '' });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });

    it('rejects non-canonical feature keys', async () => {
      const response = await controller.create({ planKey: 'base', featureKey: 'typo.feature' });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });

    it('returns error on service failure', async () => {
      mockService.create.mockResolvedValueOnce({ success: false, error: 'CONFLICT' });

      const response = await controller.create({ planKey: 'base', featureKey: 'quiz' });

      expect(response.success).toBe(false);
    });
  });

  describe('delete', () => {
    it('deletes a plan feature', async () => {
      mockService.delete.mockResolvedValueOnce({ success: true, data: undefined });

      const response = await controller.delete('550e8400-e29b-41d4-a716-446655440000');

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
    });

    it('returns 400 on invalid params', async () => {
      const response = await controller.delete('invalid');

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(400);
    });

    it('returns error on service failure', async () => {
      mockService.delete.mockResolvedValueOnce({ success: false, error: 'NOT_FOUND' });

      const response = await controller.delete('550e8400-e29b-41d4-a716-446655440000');

      expect(response.success).toBe(false);
    });
  });
});
