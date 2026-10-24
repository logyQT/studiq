import { AccountType, type RequestContext } from '@studiq/authz';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { TRACE_ID_HEADER, withAuth } from '@studiq/server/lib/with-auth';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';

function request(cookieOrgId?: string) {
  return new NextRequest('http://localhost/api/v1/example', {
    method: 'GET',
    ...(cookieOrgId && { headers: { cookie: `active_org_id=${cookieOrgId}` } }),
  });
}

/** Minimal Supabase query builder: chainable, and awaitable for `.eq()` terminals. */
function queryStub(result: { data: unknown; error?: unknown }) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => result),
    then: (onFulfilled: (value: unknown) => unknown) => Promise.resolve(result).then(onFulfilled),
  };
  return builder;
}

function stubTables(opts: {
  membership: { org_role_id: string } | null;
  groups?: { group_id: string }[];
  permissions?: { permission_name: string; scope: string }[];
}) {
  return (table: string) => {
    switch (table) {
      case 'org_members':
        return queryStub({ data: opts.membership, error: null });
      case 'group_members':
        return queryStub({ data: opts.groups ?? [], error: null });
      case 'org_role_permissions':
        return queryStub({ data: opts.permissions ?? [], error: null });
      default:
        throw new Error(`unexpected table in withAuth: ${table}`);
    }
  };
}

describe('withAuth — trace id correlation', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
  });

  it('returns 401 and still sets x-trace-id when unauthenticated', async () => {
    mock.auth.getUser.mockResolvedValue({ data: { user: null } });
    const handler = vi.fn();

    const res = await withAuth(request(), handler);

    expect(res.status).toBe(401);
    expect(res.headers.get(TRACE_ID_HEADER)).toBeTruthy();
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns the same trace id it exposed on the RequestContext', async () => {
    mock.auth.getUser.mockResolvedValue({
      data: { user: { id: 'u1', app_metadata: { account_type: AccountType.STUDENT } } },
    });
    let seenTraceId: string | undefined;

    const res = await withAuth(request(), async (ctx) => {
      seenTraceId = ctx.traceId;
      return toNextResponse({ success: true, statusCode: 200, data: { ok: true } });
    });

    expect(res.status).toBe(200);
    expect(res.headers.get(TRACE_ID_HEADER)).toBe(seenTraceId);
  });

  it('sets x-trace-id on the error path too', async () => {
    mock.auth.getUser.mockResolvedValue({
      data: { user: { id: 'u1', app_metadata: { account_type: AccountType.STUDENT } } },
    });

    const res = await withAuth(request(), async () => {
      throw new Error('boom');
    });

    expect(res.status).toBe(500);
    expect(res.headers.get(TRACE_ID_HEADER)).toBeTruthy();
  });
});

describe('withAuth — active_org_id membership gate (#186)', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
    mock.auth.getUser.mockResolvedValue({
      data: { user: { id: 'u1', app_metadata: { account_type: AccountType.STUDENT } } },
    });
  });

  it('honours the cookie org when the caller has an org_members row', async () => {
    mock.from.mockImplementation(
      stubTables({
        membership: { org_role_id: 'role-1' },
        groups: [{ group_id: 'g1' }],
        permissions: [{ permission_name: 'deck.read', scope: 'organization' }],
      }),
    );

    let ctx: RequestContext | undefined;
    const res = await withAuth(request('org-1'), async (c) => {
      ctx = c;
      return toNextResponse({ success: true, statusCode: 200, data: { ok: true } });
    });

    expect(res.status).toBe(200);
    expect(ctx?.activeOrgId).toBe('org-1');
    expect(ctx?.orgRoleId).toBe('role-1');
    expect(ctx?.groupIds).toEqual(['g1']);
    expect(ctx?.permissionScopes).toEqual({ 'deck.read': 'organization' });
  });

  it('drops the cookie org when there is no org_members row (forged / stale / removed)', async () => {
    mock.from.mockImplementation(stubTables({ membership: null, groups: [{ group_id: 'g1' }] }));

    let ctx: RequestContext | undefined;
    await withAuth(request('org-1'), async (c) => {
      ctx = c;
      return toNextResponse({ success: true, statusCode: 200, data: { ok: true } });
    });

    expect(ctx?.activeOrgId).toBeNull();
    expect(ctx?.orgRoleId).toBeNull();
    expect(ctx?.permissionScopes).toEqual({});
  });

  it('leaves the context personal when no cookie is present', async () => {
    let ctx: RequestContext | undefined;
    await withAuth(request(), async (c) => {
      ctx = c;
      return toNextResponse({ success: true, statusCode: 200, data: { ok: true } });
    });

    expect(ctx?.activeOrgId).toBeNull();
    expect(ctx?.orgRoleId).toBeNull();
    expect(mock.from).not.toHaveBeenCalled();
  });
});
