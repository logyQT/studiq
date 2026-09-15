import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserOverrideController } from '@/server/controllers/user-override.controller';

function createMockService() {
  return {
    getAll: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
}

let mockService: ReturnType<typeof createMockService>;
let controller: UserOverrideController;

describe('UserOverrideController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockService();
    controller = new UserOverrideController(mockService as any);
  });

  describe('getAll', () => {
    it('returns all overrides', async () => {
      mockService.getAll.mockResolvedValueOnce({ success: true, data: [] });
      const response = await controller.getAll();
      expect(response.success).toBe(true);
    });
    it('returns error on failure', async () => {
      mockService.getAll.mockResolvedValueOnce({ success: false, error: 'INTERNAL_SERVER' });
      const response = await controller.getAll();
      expect(response.success).toBe(false);
    });
  });

  describe('getById', () => {
    it('returns override by id', async () => {
      mockService.getById.mockResolvedValueOnce({ success: true, data: { id: 'ov-1' } });
      const response = await controller.getById('550e8400-e29b-41d4-a716-446655440000');
      expect(response.success).toBe(true);
    });
    it('returns 400 on invalid id', async () => {
      const response = await controller.getById('invalid');
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(400);
    });
  });

  describe('create', () => {
    it('creates an override', async () => {
      mockService.create.mockResolvedValueOnce({ success: true, data: { id: 'ov-1' } });
      const response = await controller.create({
        userId: '550e8400-e29b-41d4-a716-446655440000',
        featureKey: 'quiz',
        isEnabled: true,
      });
      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(201);
    });
    it('returns 422 on invalid body', async () => {
      const response = await controller.create({ userId: 'bad', featureKey: '' });
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });
    it('rejects non-canonical feature keys', async () => {
      const response = await controller.create({
        userId: '550e8400-e29b-41d4-a716-446655440000',
        featureKey: 'typo.feature',
        isEnabled: true,
      });
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });
  });

  describe('update', () => {
    it('updates an override', async () => {
      mockService.update.mockResolvedValueOnce({ success: true, data: { id: 'ov-1' } });
      const response = await controller.update('550e8400-e29b-41d4-a716-446655440000', {
        isEnabled: false,
      });
      expect(response.success).toBe(true);
    });
    it('returns 400 on invalid id', async () => {
      const response = await controller.update('invalid', { isEnabled: false });
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(400);
    });
  });

  describe('delete', () => {
    it('deletes an override', async () => {
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
