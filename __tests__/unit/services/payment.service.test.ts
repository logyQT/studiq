import { PaymentService } from '@studiq/server/services/payment.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

const ctx = { userId: 'u-1' } as unknown as Parameters<PaymentService['listMine']>[0];

function qb(rows: unknown[] | null, error: unknown = null) {
  const promise = Promise.resolve({ data: rows, error });
  const b: any = {};
  b.select = vi.fn(() => b);
  b.eq = vi.fn(() => b);
  b.order = vi.fn(() => b);
  b.then = promise.then.bind(promise);
  b.catch = promise.catch.bind(promise);
  b.finally = promise.finally.bind(promise);
  return b;
}

describe('PaymentService.listMine (#392)', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  let service: PaymentService;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
    service = new PaymentService(async () => mock as any);
  });

  it('maps payment rows to camelCase, newest first', async () => {
    const query = qb([
      {
        id: 'p-2',
        plan_key: 'ace',
        plan_name: 'StudiQ Ace',
        amount: 1999,
        currency: 'PLN',
        paid_at: '2026-10-25T10:00:00.000Z',
      },
      {
        id: 'p-1',
        plan_key: 'spark',
        plan_name: 'StudiQ Spark',
        amount: 999,
        currency: 'PLN',
        paid_at: '2026-09-01T10:00:00.000Z',
      },
    ]);
    mock.from.mockReturnValueOnce(query);

    const result = await service.listMine(ctx);

    expect(mock.from).toHaveBeenCalledWith('payments');
    expect(query.select).toHaveBeenCalledWith('id, plan_key, plan_name, amount, currency, paid_at');
    expect(query.eq).toHaveBeenCalledWith('user_id', 'u-1');
    expect(query.order).toHaveBeenCalledWith('paid_at', { ascending: false });
    expect(result).toEqual({
      success: true,
      data: [
        {
          id: 'p-2',
          planKey: 'ace',
          planName: 'StudiQ Ace',
          amount: 1999,
          currency: 'PLN',
          paidAt: '2026-10-25T10:00:00.000Z',
        },
        {
          id: 'p-1',
          planKey: 'spark',
          planName: 'StudiQ Spark',
          amount: 999,
          currency: 'PLN',
          paidAt: '2026-09-01T10:00:00.000Z',
        },
      ],
    });
  });

  it('returns an empty list when the caller has no payments', async () => {
    mock.from.mockReturnValueOnce(qb(null));

    const result = await service.listMine(ctx);

    expect(result).toEqual({ success: true, data: [] });
  });

  it('maps a database error to a ServiceResult failure', async () => {
    mock.from.mockReturnValueOnce(qb(null, { code: '42501', message: 'permission denied' }));

    const result = await service.listMine(ctx);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe('FORBIDDEN');
  });
});
