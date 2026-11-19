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
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (onFulfilled: (value: unknown) => unknown) => Promise.resolve(result).then(onFulfilled),
  };
  return builder;
}

function stubTables(opts: {
  membership: { org_role_id: string } | null;
  groups?: { group_id: string; role?: string; groups?: { organization_id: string } }[];
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

/**
 * Answers `group_members` from a real row list by applying the embedded
 * `groups.organization_id` filter, so a row from another org is dropped exactly
 * as PostgREST's `groups!inner(...)` embed drops it. Records the builder so a
 * test can assert the filter was requested at all.
 */
function orgScopedGroupStub(
  rows: { group_id: string; role: string; groups: { organization_id: string } }[],
) {
  const groupBuilders: ReturnType<typeof queryStub>[] = [];
  const from = (table: string) => {
    if (table !== 'group_members') throw new Error(`unexpected table in withAuth: ${table}`);
    const filters: [string, string][] = [];
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn((column: string, value: string) => {
        filters.push([column, value]);
        return builder;
      }),
      then: (onFulfilled: (value: unknown) => unknown) => {
        const data = rows.filter((row) =>
          filters.every(([column, value]) =>
            column === 'groups.organization_id'
              ? row.groups.organization_id === value
              : column === 'user_id',
          ),
        );
        return Promise.resolve({ data, error: null }).then(onFulfilled);
      },
    };
    groupBuilders.push(builder);
    return builder;
  };
  return { from, groupBuilders };
}

const OK = { success: true as const, statusCode: 200, data: { ok: true } };

async function captureContext(): Promise<RequestContext | undefined> {
  let ctx: RequestContext | undefined;
  await withAuth(request('org-a'), (c) => {
    ctx = c;
    return Promise.resolve(toNextResponse(OK));
  });
  return ctx;
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

    const res = await withAuth(request(), (ctx) => {
      seenTraceId = ctx.traceId;
      return Promise.resolve(
        toNextResponse({ success: true, statusCode: 200, data: { ok: true } }),
      );
    });

    expect(res.status).toBe(200);
    expect(res.headers.get(TRACE_ID_HEADER)).toBe(seenTraceId);
  });

  it('sets x-trace-id on the error path too', async () => {
    mock.auth.getUser.mockResolvedValue({
      data: { user: { id: 'u1', app_metadata: { account_type: AccountType.STUDENT } } },
    });

    const res = await withAuth(request(), () => {
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
        groups: [{ group_id: 'g1', role: 'member', groups: { organization_id: 'org-1' } }],
        permissions: [{ permission_name: 'deck.read', scope: 'organization' }],
      }),
    );

    let ctx: RequestContext | undefined;
    const res = await withAuth(request('org-1'), (c) => {
      ctx = c;
      return Promise.resolve(
        toNextResponse({ success: true, statusCode: 200, data: { ok: true } }),
      );
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
    await withAuth(request('org-1'), (c) => {
      ctx = c;
      return Promise.resolve(
        toNextResponse({ success: true, statusCode: 200, data: { ok: true } }),
      );
    });

    expect(ctx?.activeOrgId).toBeNull();
    expect(ctx?.orgRoleId).toBeNull();
    expect(ctx?.permissionScopes).toEqual({});
  });

  it('leaves the context personal when no cookie is present', async () => {
    let ctx: RequestContext | undefined;
    await withAuth(request(), (c) => {
      ctx = c;
      return Promise.resolve(
        toNextResponse({ success: true, statusCode: 200, data: { ok: true } }),
      );
    });

    expect(ctx?.activeOrgId).toBeNull();
    expect(ctx?.orgRoleId).toBeNull();
    expect(mock.from).not.toHaveBeenCalled();
  });
});

describe('withAuth — group roles are org-scoped (ADR-0015 §7.1)', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
    mock.auth.getUser.mockResolvedValue({
      data: { user: { id: 'u1', app_metadata: { account_type: AccountType.EDUCATOR } } },
    });
  });

  it('leaves out a group that belongs to another org', async () => {
    const stub = orgScopedGroupStub([
      { group_id: 'g-org-a', role: 'teacher', groups: { organization_id: 'org-a' } },
      { group_id: 'g-org-b', role: 'member', groups: { organization_id: 'org-b' } },
    ]);
    mock.from.mockImplementation((table: string) =>
      table === 'group_members'
        ? stub.from(table)
        : stubTables({ membership: { org_role_id: 'role-a' } })(table),
    );

    const ctx = await captureContext();

    expect(ctx?.groupIds).toEqual(['g-org-a']);
    expect(ctx?.groupRoles).toEqual({ 'g-org-a': 'teacher' });
    expect(stub.groupBuilders[0]?.eq).toHaveBeenCalledWith('groups.organization_id', 'org-a');
  });

  it('carries each in-org group role, and groupIds is exactly the keys of groupRoles', async () => {
    const stub = orgScopedGroupStub([
      { group_id: 'g-1', role: 'teacher', groups: { organization_id: 'org-a' } },
      { group_id: 'g-2', role: 'member', groups: { organization_id: 'org-a' } },
    ]);
    mock.from.mockImplementation((table: string) =>
      table === 'group_members'
        ? stub.from(table)
        : stubTables({ membership: { org_role_id: 'role-a' } })(table),
    );

    const ctx = await captureContext();

    expect(ctx?.groupRoles).toEqual({ 'g-1': 'teacher', 'g-2': 'member' });
    expect([...(ctx?.groupIds ?? [])].toSorted()).toEqual(
      Object.keys(ctx?.groupRoles ?? {}).toSorted(),
    );
  });

  it('keeps no group ids or roles when the cookie org is not a membership', async () => {
    const stub = orgScopedGroupStub([
      { group_id: 'g-org-b', role: 'teacher', groups: { organization_id: 'org-b' } },
    ]);
    mock.from.mockImplementation((table: string) =>
      table === 'group_members' ? stub.from(table) : stubTables({ membership: null })(table),
    );

    const ctx = await captureContext();

    expect(ctx?.groupIds).toEqual([]);
    expect(ctx?.groupRoles).toEqual({});
  });

  it('keeps no group ids or roles without an active org', async () => {
    let ctx: RequestContext | undefined;
    await withAuth(request(), (c) => {
      ctx = c;
      return Promise.resolve(toNextResponse(OK));
    });

    expect(ctx?.groupIds).toEqual([]);
    expect(ctx?.groupRoles).toEqual({});
  });
});
