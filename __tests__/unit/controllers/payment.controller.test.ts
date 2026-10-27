import type { RequestContext } from '@studiq/authz';
import { PaymentController } from '@studiq/server/controllers/payment.controller';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function createMockService() {
  return { listMine: vi.fn() };
}

let mockService: ReturnType<typeof createMockService>;
let controller: PaymentController;

const mockCtx = {
  traceId: 'test',
  userId: 'u-1',
  accountType: 'student',
  orgRoleId: null,
  activeOrgId: null,
  url: '',
  method: 'GET',
  groupIds: [],
  permissionScopes: {},
} as unknown as RequestContext;

const payment = {
  id: 'p-1',
  planKey: 'spark',
  planName: 'StudiQ Spark',
  amount: 999,
  currency: 'PLN',
  paidAt: '2026-10-25T10:00:00.000Z',
};

describe('PaymentController.listMine (#392)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockService();
    controller = new PaymentController(mockService as any);
  });

  it('returns 200 and the caller payment history', async () => {
    mockService.listMine.mockResolvedValueOnce({ success: true, data: [payment] });

    const response = await controller.listMine(mockCtx);

    expect(mockService.listMine).toHaveBeenCalledWith(mockCtx);
    expect(response).toEqual({ success: true, statusCode: 200, data: [payment] });
  });

  it('returns 200 and an empty list when there are no payments', async () => {
    mockService.listMine.mockResolvedValueOnce({ success: true, data: [] });

    const response = await controller.listMine(mockCtx);

    expect(response).toEqual({ success: true, statusCode: 200, data: [] });
  });

  it('maps a service failure to the matching status code', async () => {
    mockService.listMine.mockResolvedValueOnce({ success: false, error: 'INTERNAL_SERVER' });

    const response = await controller.listMine(mockCtx);

    expect(response.success).toBe(false);
    expect(response.statusCode).toBe(500);
    if (!response.success) expect(response.error).toBe('INTERNAL_SERVER');
  });
});
