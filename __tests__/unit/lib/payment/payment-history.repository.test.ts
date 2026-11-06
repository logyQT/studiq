import {
  SupabasePaymentHistoryWriter,
  type PaymentHistoryInput,
} from '@studiq/server/lib/payment/payment-history.repository';
import type { Database } from '@studiq/server/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import { asJson } from '#test/helpers/json';
import { describe, expect, it, vi } from 'vitest';

const mockInput: PaymentHistoryInput = {
  provider: 'mock',
  sessionId: 'cs_mock_1',
  userId: 'u-1',
  organizationId: null,
  planKey: 'spark',
  planName: 'StudiQ Spark',
  amount: 999,
  currency: 'PLN',
};

interface ClientOptions {
  /** Result of the provider-key lookup that runs after a unique violation. */
  lookup: {
    data: Record<string, string | null> | null;
    error: { code: string; message: string } | null;
  };
}

function createClient({ lookup }: ClientOptions) {
  const select = vi.fn();
  const eq = vi.fn();
  const maybeSingleLookup = vi.fn().mockResolvedValue(lookup);
  const maybeSingleInsert = vi.fn().mockResolvedValue({
    data: null,
    error: { code: '23505', message: 'duplicate key value violates unique constraint' },
  });

  const lookupQuery = { select, eq, maybeSingle: maybeSingleLookup };
  select.mockReturnValue(lookupQuery);
  eq.mockReturnValue(lookupQuery);

  const insertQuery = { select: vi.fn(), maybeSingle: maybeSingleInsert };
  insertQuery.select.mockReturnValue(insertQuery);

  const insert = vi.fn().mockReturnValue(insertQuery);

  return asJson<SupabaseClient<Database>>({
    from: vi.fn().mockReturnValue({ insert, ...lookupQuery }),
  });
}

describe('SupabasePaymentHistoryWriter.record', () => {
  it('surfaces a lookup failure instead of misreporting CONFLICT', async () => {
    const client = createClient({
      lookup: { data: null, error: { code: '08006', message: 'connection failure' } },
    });
    const writer = new SupabasePaymentHistoryWriter(() => client);

    await expect(writer.record(mockInput)).resolves.toEqual({
      success: false,
      error: 'INTERNAL_SERVER',
    });
  });

  it('returns the recorded purchase on a replay', async () => {
    const client = createClient({
      lookup: {
        data: { user_id: 'u-1', organization_id: null, plan_key: 'spark' },
        error: null,
      },
    });
    const writer = new SupabasePaymentHistoryWriter(() => client);

    await expect(writer.record(mockInput)).resolves.toEqual({
      success: true,
      data: {
        outcome: 'duplicate',
        existing: { userId: 'u-1', organizationId: null, planKey: 'spark' },
      },
    });
  });

  it('reports CONFLICT only when the provider key resolves to no row', async () => {
    const client = createClient({ lookup: { data: null, error: null } });
    const writer = new SupabasePaymentHistoryWriter(() => client);

    await expect(writer.record(mockInput)).resolves.toEqual({
      success: false,
      error: 'CONFLICT',
    });
  });
});
