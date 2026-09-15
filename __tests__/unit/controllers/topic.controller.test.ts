import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TopicController } from '@/server/controllers/topic.controller';
import type { RequestContext } from '@/lib/request-context';

vi.mock('@/lib/authz', () => ({
  can: vi.fn().mockResolvedValue(true),
  Permission: { TOPIC_CREATE: 'topic.create', TOPIC_READ: 'topic.read' },
}));

function createMockService() {
  return {
    create: vi.fn(),
    list: vi.fn(),
    getById: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    bulkCreate: vi.fn(),
    batchDelete: vi.fn(),
  };
}

let mockService: ReturnType<typeof createMockService>;
let controller: TopicController;
const mockCtx: RequestContext = {
  traceId: 'test', userId: 'u-1', accountType: 'educator' as any,
  orgRoleId: null, activeOrgId: 'org-1', url: '', method: 'GET', groupIds: [], permissionScopes: {},
};

describe('TopicController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockService();
    controller = new TopicController(mockService as any);
  });

  describe('create', () => {
    it('creates a topic', async () => {
      mockService.create.mockResolvedValueOnce({ success: true, data: { id: 't-1', name: 'Math' } });
      const response = await controller.create({ name: 'Math' }, mockCtx);
      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(201);
    });
    it('returns 422 on invalid body', async () => {
      const response = await controller.create({ name: '' }, mockCtx);
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });
    it('returns error on service failure', async () => {
      mockService.create.mockResolvedValueOnce({ success: false, error: 'FORBIDDEN' });
      const response = await controller.create({ name: 'Math' }, mockCtx);
      expect(response.success).toBe(false);
    });
  });

  describe('list', () => {
    it('returns topics', async () => {
      mockService.list.mockResolvedValueOnce({ success: true, data: { items: [], nextCursor: null, hasMore: false } });
      const response = await controller.list({}, mockCtx);
      expect(response.success).toBe(true);
    });
    it('returns error on failure', async () => {
      mockService.list.mockResolvedValueOnce({ success: false, error: 'INTERNAL_SERVER' });
      const response = await controller.list({}, mockCtx);
      expect(response.success).toBe(false);
    });
  });

  describe('getById', () => {
    it('returns topic by id', async () => {
      mockService.getById.mockResolvedValueOnce({ success: true, data: { id: 't-1' } });
      const response = await controller.getById('t-1', mockCtx);
      expect(response.success).toBe(true);
    });
    it('returns error on failure', async () => {
      mockService.getById.mockResolvedValueOnce({ success: false, error: 'NOT_FOUND' });
      const response = await controller.getById('nonexistent', mockCtx);
      expect(response.success).toBe(false);
    });
  });

  describe('update', () => {
    it('updates a topic', async () => {
      mockService.update.mockResolvedValueOnce({ success: true, data: { id: 't-1' } });
      const response = await controller.update('t-1', { name: 'Updated' }, mockCtx);
      expect(response.success).toBe(true);
    });
    it('returns 422 on invalid body', async () => {
      const response = await controller.update('t-1', { name: '' }, mockCtx);
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });
  });

  describe('delete', () => {
    it('deletes a topic', async () => {
      mockService.delete.mockResolvedValueOnce({ success: true, data: undefined });
      const response = await controller.delete('t-1', mockCtx);
      expect(response.success).toBe(true);
    });
    it('returns error on failure', async () => {
      mockService.delete.mockResolvedValueOnce({ success: false, error: 'NOT_FOUND' });
      const response = await controller.delete('nonexistent', mockCtx);
      expect(response.success).toBe(false);
    });
  });

  describe('bulkCreate', () => {
    it('bulk creates topics', async () => {
      mockService.bulkCreate.mockResolvedValueOnce({ success: true, data: [] });
      const response = await controller.bulkCreate({ topics: [{ name: 'T1' }, { name: 'T2' }] }, mockCtx);
      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(201);
    });
    it('returns 422 on invalid body', async () => {
      const response = await controller.bulkCreate({ topics: [] }, mockCtx);
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });
  });

  describe('batchDelete', () => {
    it('batch deletes topics', async () => {
      mockService.batchDelete.mockResolvedValueOnce({ success: true, data: { deleted: 2 } });
      const response = await controller.batchDelete({ ids: ['550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440002'] }, mockCtx);
      expect(response.success).toBe(true);
    });
    it('returns 422 on invalid body', async () => {
      const response = await controller.batchDelete({ ids: 'invalid' }, mockCtx);
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });
  });
});
