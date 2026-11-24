import { AccountType, type RequestContext } from '@studiq/authz';
import { getSeatPlanKey } from '@studiq/server/services/seat.plan';
import { describe, expect, it } from 'vitest';
import { chain } from '#test/helpers/entitlement-resolver-mock';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

const ctx: RequestContext = {
  userId: 'user-1',
  accountType: AccountType.STUDENT,
  traceId: 't',
  url: '',
  method: 'GET',
  activeOrgId: 'org-1',
  orgRoleId: 'role-member',
  groupIds: [],
  permissionScopes: {},
};

function clientReturning(result: unknown, error: { code: string; message: string } | null) {
  const mock = mockSupabaseClient();
  mock.from.mockImplementation(() => chain(result, error));
  return mock;
}

describe('getSeatPlanKey (#1373)', () => {
  it('returns the pool plan key for a seated member', async () => {
    const mock = clientReturning({ pool_id: 'pool-1', org_seat_pools: { plan_key: 'seat' } }, null);

    expect(await getSeatPlanKey(ctx, mock)).toEqual({ success: true, data: 'seat' });
  });

  it('returns success(null) when there is no seat row', async () => {
    const mock = clientReturning(null, null);

    expect(await getSeatPlanKey(ctx, mock)).toEqual({ success: true, data: null });
  });

  it('fails with INTERNAL_SERVER when the read fails, and does not read as "not seated"', async () => {
    const mock = clientReturning(null, { code: '57014', message: 'statement timeout' });

    expect(await getSeatPlanKey(ctx, mock)).toEqual({ success: false, error: 'INTERNAL_SERVER' });
  });

  it('returns success(null) without querying when there is no active org', async () => {
    const mock = clientReturning(null, null);

    expect(await getSeatPlanKey({ ...ctx, activeOrgId: null }, mock)).toEqual({
      success: true,
      data: null,
    });
    expect(mock.from).not.toHaveBeenCalled();
  });
});
