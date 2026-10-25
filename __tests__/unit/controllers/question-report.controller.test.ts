import type { RequestContext } from '@studiq/authz';
import { QuestionReportController } from '@studiq/server/controllers/question-report.controller';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function createMockService() {
  return {
    createReport: vi.fn(),
    list: vi.fn(),
    setStatus: vi.fn(),
    getById: vi.fn(),
    addMessage: vi.fn(),
    markRead: vi.fn(),
    unreadCount: vi.fn(),
  };
}

let mockService: ReturnType<typeof createMockService>;
let controller: QuestionReportController;

const mockCtx: RequestContext = {
  traceId: 'test-trace',
  userId: 'test-user-id',
  accountType: 'student' as any,
  orgRoleId: null,
  activeOrgId: null,
  url: 'http://localhost',
  method: 'GET',
  groupIds: [],
  permissionScopes: {},
};

describe('QuestionReportController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockService();
    controller = new QuestionReportController(mockService as any);
  });

  describe('createReport', () => {
    it('creates a report', async () => {
      mockService.createReport.mockResolvedValueOnce({ success: true, data: { id: 'r-1' } });

      const response = await controller.createReport('q-1', { message: 'Wrong answer' }, mockCtx);

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(201);
    });

    it('returns 422 on invalid body', async () => {
      const response = await controller.createReport('q-1', { message: '' }, mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });

    it('returns error on service failure', async () => {
      mockService.createReport.mockResolvedValueOnce({ success: false, error: 'BAD_REQUEST' });

      const response = await controller.createReport('q-1', { message: 'test' }, mockCtx);

      expect(response.success).toBe(false);
    });
  });

  describe('list', () => {
    it('passes the parsed query to the service', async () => {
      mockService.list.mockResolvedValueOnce({
        success: true,
        data: { items: [], nextCursor: null, hasMore: false },
      });

      const response = await controller.list({ status: 'open', limit: 10 }, mockCtx);

      expect(response.success).toBe(true);
      expect(mockService.list).toHaveBeenCalledWith(
        mockCtx,
        expect.objectContaining({ status: 'open', limit: 10 }),
      );
    });

    it('defaults the query when nothing is provided', async () => {
      mockService.list.mockResolvedValueOnce({ success: true, data: {} });

      const response = await controller.list({}, mockCtx);

      expect(response.success).toBe(true);
      expect(mockService.list).toHaveBeenCalledWith(
        mockCtx,
        expect.objectContaining({
          status: 'all',
          sortBy: 'updated_at',
          sortOrder: 'desc',
          limit: 24,
        }),
      );
    });

    it('returns 422 on an invalid status', async () => {
      const response = await controller.list({ status: 'bogus' }, mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect(mockService.list).not.toHaveBeenCalled();
    });

    it('returns 422 on an out-of-range limit', async () => {
      const response = await controller.list({ limit: 999 }, mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });

    it('returns error on failure', async () => {
      mockService.list.mockResolvedValueOnce({ success: false, error: 'INTERNAL_SERVER' });

      const response = await controller.list({}, mockCtx);

      expect(response.success).toBe(false);
    });
  });

  describe('setStatus', () => {
    it('returns the updated report', async () => {
      mockService.setStatus.mockResolvedValueOnce({
        success: true,
        data: { id: 'r-1', status: 'resolved' },
      });

      const response = await controller.setStatus('r-1', { status: 'resolved' }, mockCtx);

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(200);
      expect(mockService.setStatus).toHaveBeenCalledWith('r-1', { status: 'resolved' }, mockCtx);
    });

    it('returns 422 for an unknown status', async () => {
      const response = await controller.setStatus('r-1', { status: 'closed' }, mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
      expect(mockService.setStatus).not.toHaveBeenCalled();
    });
  });

  describe('getById', () => {
    it('returns report by id', async () => {
      mockService.getById.mockResolvedValueOnce({
        success: true,
        data: { report: {}, messages: [] },
      });

      const response = await controller.getById('r-1', mockCtx);

      expect(response.success).toBe(true);
    });

    it('returns error on service failure', async () => {
      mockService.getById.mockResolvedValueOnce({ success: false, error: 'NOT_FOUND' });

      const response = await controller.getById('r-1', mockCtx);

      expect(response.success).toBe(false);
    });
  });

  describe('addMessage', () => {
    it('adds a message', async () => {
      mockService.addMessage.mockResolvedValueOnce({ success: true, data: { id: 'm-1' } });

      const response = await controller.addMessage('r-1', { body: 'test' }, mockCtx);

      expect(response.success).toBe(true);
      expect(response.statusCode).toBe(201);
    });

    it('returns 422 on invalid body', async () => {
      const response = await controller.addMessage('r-1', { body: '' }, mockCtx);

      expect(response.success).toBe(false);
      expect(response.statusCode).toBe(422);
    });
  });

  describe('markRead', () => {
    it('marks report as read', async () => {
      mockService.markRead.mockResolvedValueOnce({ success: true, data: null });

      const response = await controller.markRead('r-1', mockCtx);

      expect(response.success).toBe(true);
    });
  });

  describe('unreadCount', () => {
    it('returns count', async () => {
      mockService.unreadCount.mockResolvedValueOnce({ success: true, data: { count: 3 } });

      const response = await controller.unreadCount(mockCtx);

      expect(response.success).toBe(true);
      expect((response as any).data.count).toBe(3);
    });

    it('returns error on failure', async () => {
      mockService.unreadCount.mockResolvedValueOnce({ success: false, error: 'INTERNAL_SERVER' });

      const response = await controller.unreadCount(mockCtx);

      expect(response.success).toBe(false);
    });
  });
});
