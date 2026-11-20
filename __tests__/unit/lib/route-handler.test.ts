import { AppError } from '@studiq/server/lib/errors';
import { authedRoute, authedRouteWithParams } from '@studiq/server/lib/route-handler';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The wrapper owns auth and response shaping; the gate itself is covered by the
// with-auth specs. Recording the handler lets a case drive the gate directly.
const { authed } = vi.hoisted(() => ({ authed: vi.fn() }));

vi.mock('@studiq/server/lib/with-auth', async () => {
  const { AccountType } = await import('@studiq/authz');
  const ctx = {
    userId: 'user-1',
    accountType: AccountType.MANAGER,
    traceId: 'test',
    url: '',
    method: 'GET',
    activeOrgId: 'org-1',
    orgRoleId: 'role-1',
    groupIds: [],
    groupRoles: {},
    permissionScopes: {},
  };
  return {
    withAuth: (req: unknown, handler: (c: typeof ctx) => unknown) => {
      authed(req, handler);
      return handler(ctx);
    },
  };
});

const BASE = 'http://localhost/api/v1/organization/groups/group-9';

function request(method: string, body?: unknown) {
  return new NextRequest(BASE, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const context = { params: Promise.resolve({ id: 'group-9' }) };
const ok = () => Promise.resolve({ success: true as const, statusCode: 200 });

describe('authedRoute', () => {
  beforeEach(() => {
    authed.mockClear();
  });

  it('passes the caller context to the controller', async () => {
    const controller = vi.fn(ok);

    await authedRoute(() => [], controller)(request('GET'));

    expect(controller).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1' }));
  });

  it('hands a params-less handler no params', async () => {
    const read = vi.fn(() => [] as []);
    const controller = vi.fn(ok);

    await authedRoute(read, controller)(request('GET'));

    expect(read).toHaveBeenCalledWith({ params: undefined, json: undefined });
  });

  it('reads a body only when the route declares one', async () => {
    const read = vi.fn(() => [] as []);

    await authedRoute(read, vi.fn(ok))(request('POST', { ignored: true }));

    expect(read).toHaveBeenCalledWith({ params: undefined, json: undefined });
  });

  it('parses the body a route declares', async () => {
    const controller = vi.fn(ok);

    await authedRoute(({ json }) => [json], controller, { readsBody: true })(
      request('POST', { name: 'Grupa C' }),
    );

    expect(controller).toHaveBeenCalledWith(expect.anything(), { name: 'Grupa C' });
  });

  it('shapes a controller success with the envelope', async () => {
    const response = await authedRoute(
      () => [],
      () => Promise.resolve({ success: true as const, statusCode: 201, data: { id: 'group-9' } }),
    )(request('GET'));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ success: true, data: { id: 'group-9' } });
  });

  it('shapes a controller failure with its code and status header', async () => {
    const response = await authedRoute(
      () => [],
      () =>
        Promise.resolve({ success: false as const, statusCode: 403, error: 'FORBIDDEN' as const }),
    )(request('GET'));

    expect(response.status).toBe(403);
    expect(response.headers.get('x-error-code')).toBe('FORBIDDEN');
    await expect(response.json()).resolves.toMatchObject({ success: false, error: 'FORBIDDEN' });
  });
});

describe('authedRouteWithParams', () => {
  beforeEach(() => {
    authed.mockClear();
  });

  it('resolves the route params before the controller runs', async () => {
    const controller = vi.fn(ok);

    await authedRouteWithParams<{ id: string }, [string]>(({ params }) => [params.id], controller)(
      request('GET'),
      context,
    );

    expect(controller).toHaveBeenCalledWith(expect.anything(), 'group-9');
  });

  it('hands the parsed body to a write handler', async () => {
    const controller = vi.fn(ok);

    await authedRouteWithParams<{ id: string }, [string, unknown]>(
      ({ params, json }) => [params.id, json],
      controller,
      { readsBody: true },
    )(request('PUT', { name: 'Grupa C' }), context);

    expect(controller).toHaveBeenCalledWith(expect.anything(), 'group-9', { name: 'Grupa C' });
  });

  /**
   * The regression CI caught: a body-less `DELETE` read `req.json()`, so the
   * empty stream became a 400 in front of the controller's own 403. The route
   * declares no body, so the controller must decide the outcome.
   */
  it('never parses a body for a DELETE that declares none', async () => {
    const controller = vi.fn(() =>
      Promise.resolve({ success: false as const, statusCode: 403, error: 'FORBIDDEN' as const }),
    );

    const response = await authedRouteWithParams<{ id: string }, [string]>(
      ({ params }) => [params.id],
      controller,
    )(request('DELETE'), context);

    expect(response.status).toBe(403);
    expect(controller).toHaveBeenCalledWith(expect.anything(), 'group-9');
  });

  it('does not reach the controller when a declared body cannot be parsed', async () => {
    const controller = vi.fn(ok);

    await expect(
      authedRouteWithParams<{ id: string }, [string, unknown]>(
        ({ params, json }) => [params.id, json],
        controller,
        { readsBody: true },
      )(request('PUT'), context),
    ).rejects.toBeInstanceOf(SyntaxError);

    expect(authed).toHaveBeenCalledTimes(1);
    expect(controller).not.toHaveBeenCalled();
  });

  it('waits for a params promise that resolves late', async () => {
    const controller = vi.fn(ok);
    let resolve!: (value: { id: string }) => void;
    const params = new Promise<{ id: string }>((r) => {
      resolve = r;
    });
    const pending = authedRouteWithParams<{ id: string }, [string]>(
      ({ params: p }) => [p.id],
      controller,
    )(request('GET'), { params });
    resolve({ id: 'late-id' });

    await pending;

    expect(controller).toHaveBeenCalledWith(expect.anything(), 'late-id');
  });
});

describe('authedRoute with a controller that throws', () => {
  it('lets an AppError reach the caller with its own status', async () => {
    await expect(
      authedRoute(
        () => [],
        () => Promise.reject(new AppError('NOT_FOUND')),
      )(request('GET')),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
  });
});
