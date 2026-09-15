import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QuestionBankController } from '@/server/controllers/question-bank.controller';
import type { RequestContext } from '@/lib/request-context';

vi.mock('@/lib/access', () => ({
  can: vi.fn().mockResolvedValue(true),
  Permission: { QUESTION_BANK_CREATE: 'question_bank.create' },
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
let controller: QuestionBankController;
const mockCtx: RequestContext = {
  traceId: 'test', userId: 'u-1', accountType: 'educator' as any,
  orgRoleId: null, activeOrgId: 'org-1', url: '', method: 'GET', groupIds: [], permissionScopes: {},
};

describe('QuestionBankController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockService();
    controller = new QuestionBankController(mockService as any);
  });

  describe('create', () => {
    it('creates a bank', async () => {
      mockService.create.mockResolvedValueOnce({ success: true, data: { id: 'b-1' } });
      const response = await controller.create({ name: 'Test Bank' }, mockCtx);
      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(201);
    });
    it('returns 422 on invalid body', async () => {
      const response = await controller.create({ name: '' }, mockCtx);
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });
  });

  describe('list', () => {
    it('returns banks', async () => {
      mockService.list.mockResolvedValueOnce({ success: true, data: [] });
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
    it('returns bank by id', async () => {
      mockService.getById.mockResolvedValueOnce({ success: true, data: { id: 'b-1' } });
      const response = await controller.getById('b-1', mockCtx);
      expect(response.success).toBe(true);
    });
    it('returns error on failure', async () => {
      mockService.getById.mockResolvedValueOnce({ success: false, error: 'NOT_FOUND' });
      const response = await controller.getById('nonexistent', mockCtx);
      expect(response.success).toBe(false);
    });
  });

  describe('update', () => {
    it('updates a bank', async () => {
      mockService.update.mockResolvedValueOnce({ success: true, data: { id: 'b-1' } });
      const response = await controller.update('b-1', { name: 'Updated' }, mockCtx);
      expect(response.success).toBe(true);
    });
    it('returns 422 on invalid body', async () => {
      const response = await controller.update('b-1', { name: '' }, mockCtx);
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });
  });

  describe('delete', () => {
    it('deletes a bank', async () => {
      mockService.delete.mockResolvedValueOnce({ success: true, data: undefined });
      const response = await controller.delete('b-1', mockCtx);
      expect(response.success).toBe(true);
    });
  });

  describe('bulkCreate', () => {
    it('bulk creates banks', async () => {
      mockService.bulkCreate.mockResolvedValueOnce({ success: true, data: [] });
      const response = await controller.bulkCreate({ banks: [{ name: 'Bank 1' }] }, mockCtx);
      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(201);
    });
    it('returns 422 on invalid body', async () => {
      const response = await controller.bulkCreate({ banks: [] }, mockCtx);
      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });
  });

  describe('batchDelete', () => {
    it('batch deletes banks', async () => {
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
