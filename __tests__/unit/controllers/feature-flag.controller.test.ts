import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FeatureFlagController } from '@/server/controllers/feature-flag.controller';

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
let controller: FeatureFlagController;

describe('FeatureFlagController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockService();
    controller = new FeatureFlagController(mockService as any);
  });

  describe('getAll', () => {
    it('returns all flags', async () => {
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

  describe('getById', () => {
    it('returns flag by id', async () => {
      mockService.getById.mockResolvedValueOnce({ success: true, data: { id: 'ff-1' } });

      const response = await controller.getById('550e8400-e29b-41d4-a716-446655440000');

      expect(response.success).toBe(true);
    });

    it('returns 400 on invalid params', async () => {
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
    it('creates a flag', async () => {
      mockService.create.mockResolvedValueOnce({ success: true, data: { id: 'ff-1' } });

      const response = await controller.create({ key: 'quiz', name: 'Quiz' });

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(201);
    });

    it('returns 422 on invalid body', async () => {
      const response = await controller.create({ key: 'Invalid Key!', name: '' });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });

    it('returns error on service failure', async () => {
      mockService.create.mockResolvedValueOnce({ success: false, error: 'CONFLICT' });

      const response = await controller.create({ key: 'quiz', name: 'Quiz' });

      expect(response.success).toBe(false);
    });
  });

  describe('update', () => {
    it('updates a flag', async () => {
      mockService.update.mockResolvedValueOnce({ success: true, data: { id: 'ff-1' } });

      const response = await controller.update('550e8400-e29b-41d4-a716-446655440000', { name: 'Updated' });

      expect(response.success).toBe(true);
    });

    it('returns 400 on invalid params', async () => {
      const response = await controller.update('invalid', { name: 'Updated' });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(400);
    });

    it('returns 422 on invalid body', async () => {
      const response = await controller.update('550e8400-e29b-41d4-a716-446655440000', { key: 'Invalid Key!' });

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });

    it('returns error on service failure', async () => {
      mockService.update.mockResolvedValueOnce({ success: false, error: 'NOT_FOUND' });

      const response = await controller.update('550e8400-e29b-41d4-a716-446655440000', { name: 'Updated' });

      expect(response.success).toBe(false);
    });
  });

  describe('delete', () => {
    it('deletes a flag', async () => {
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
      mockService.delete.mockResolvedValueOnce({ success: false, error: 'INTERNAL_SERVER' });

      const response = await controller.delete('550e8400-e29b-41d4-a716-446655440000');

      expect(response.success).toBe(false);
    });
  });
});
