/**
 * Admin PEM gate — parser, scope map and full proxy status matrix.
 *
 * The proxy caches its keyring in module scope, so every environment variation
 * resets the module registry and re-imports `@admin/proxy`.
 */
import { hasScope, KNOWN_SCOPES, parseKeyring, requiredScope } from '@admin/lib/admin-pem';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAdminTestKey,
  type AdminTestKey,
  ringEntry,
  ringJson,
  signAdminRequest,
} from '#test/helpers/admin-pem';

const logger = vi.hoisted(() => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() }));

vi.mock('@studiq/server/lib/log', () => logger);

const SAVED_ENV = {
  ADMIN_PEM_KEYS: process.env.ADMIN_PEM_KEYS,
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  if (SAVED_ENV.ADMIN_PEM_KEYS === undefined) delete process.env.ADMIN_PEM_KEYS;
  else process.env.ADMIN_PEM_KEYS = SAVED_ENV.ADMIN_PEM_KEYS;
});

beforeEach(() => {
  logger.log.mockClear();
  logger.warn.mockClear();
  logger.error.mockClear();
});

async function loadProxy(options: { keys?: string; nodeEnv?: string } = {}) {
  vi.resetModules();
  if (options.keys === undefined) delete process.env.ADMIN_PEM_KEYS;
  else process.env.ADMIN_PEM_KEYS = options.keys;
  vi.stubEnv('NODE_ENV', options.nodeEnv ?? 'test');
  const mod = await import('@admin/proxy');
  return mod.proxy;
}

function ring(...entries: Array<{ key: AdminTestKey; scopes?: string[]; expiresAt?: string }>) {
  return ringJson(
    entries.map((entry) =>
      ringEntry(entry.key, { scopes: entry.scopes ?? [], expiresAt: entry.expiresAt }),
    ),
  );
}

function request(
  pathWithQuery: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
) {
  return new NextRequest(new URL(pathWithQuery, 'http://localhost:4000'), {
    method: init.method,
    headers: init.headers,
    ...(init.body !== undefined ? { body: init.body } : {}),
  });
}

function signed(
  key: AdminTestKey,
  pathWithQuery: string,
  init: { method?: string; body?: string; headers?: Record<string, string> } = {},
) {
  const headers = {
    ...init.headers,
    ...signAdminRequest({
      key,
      url: pathWithQuery,
      method: init.method ?? 'GET',
      body: init.body,
    }),
  };
  return request(pathWithQuery, { ...init, headers });
}

async function expectPassed(res: Response) {
  expect(res.status).toBe(200);
  expect(res.headers.get('x-middleware-next')).toBe('1');
}

async function expectDenied(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  await expect(res.json()).resolves.toEqual({ success: false, error: code });
}

const UNAUTHORIZED = 'ERROR_UNAUTHORIZED';
const FORBIDDEN = 'ERROR_FORBIDDEN';

describe('admin PEM gate — parseKeyring', () => {
  it('parses a valid ring with id, scopes and expiry', () => {
    const key = createAdminTestKey('ops-1');
    const parsed = parseKeyring(
      JSON.stringify([ringEntry(key, { scopes: ['feature-flags:read'], expiresAt: '2027-01-01' })]),
    );

    expect(parsed.rejected).toEqual([]);
    expect(parsed.unknownScopes).toEqual([]);
    expect(parsed.keys).toHaveLength(1);
    expect(parsed.keys[0].id).toBe('ops-1');
    expect([...parsed.keys[0].scopes]).toEqual(['feature-flags:read']);
    expect(parsed.keys[0].expiresAt).toBe(Date.parse('2027-01-01'));
  });

  it('returns an empty ring for blank config', () => {
    expect(parseKeyring('   ')).toEqual({ keys: [], rejected: [], unknownScopes: [] });
  });

  it('skips malformed entries and keeps the valid ones', () => {
    const key = createAdminTestKey('valid');
    const parsed = parseKeyring(
      JSON.stringify([
        { id: 'broken', key: 'not-a-key', scopes: [] },
        ringEntry(key, { scopes: ['users:read'] }),
      ]),
    );

    expect(parsed.keys.map((k) => k.id)).toEqual(['valid']);
    expect(parsed.rejected).toHaveLength(1);
    expect(parsed.rejected[0]).toMatchObject({ index: 0, id: 'broken' });
  });

  it('rejects duplicate ids', () => {
    const first = createAdminTestKey('same');
    const second = createAdminTestKey('same');
    const parsed = parseKeyring(JSON.stringify([ringEntry(first), ringEntry(second)]));

    expect(parsed.keys).toHaveLength(1);
    expect(parsed.rejected[0]?.reason).toMatch(/duplicate id/);
  });

  it('keeps unknown scopes but reports them', () => {
    const key = createAdminTestKey('typo');
    const parsed = parseKeyring(
      JSON.stringify([ringEntry(key, { scopes: ['feature-flags:reed'] })]),
    );

    expect([...parsed.keys[0].scopes]).toEqual(['feature-flags:reed']);
    expect(parsed.unknownScopes).toEqual(['feature-flags:reed']);
  });

  it('reports invalid JSON as a rejected entry', () => {
    const parsed = parseKeyring('{not json');
    expect(parsed.keys).toEqual([]);
    expect(parsed.rejected).toHaveLength(1);
    expect(parsed.rejected[0]?.index).toBe(-1);
  });
});

describe('admin PEM gate — scope map', () => {
  it('maps every current route + method to its scope', () => {
    const table: Array<[string, string, string | null]> = [
      ['GET', '/api/v1/organizations', 'organizations:read'],
      ['GET', '/api/v1/organizations/org-1', 'organizations:read'],
      ['GET', '/api/v1/feature-flags', 'feature-flags:read'],
      ['POST', '/api/v1/feature-flags', 'feature-flags:write'],
      ['GET', '/api/v1/feature-flags/flag-1', 'feature-flags:read'],
      ['PUT', '/api/v1/feature-flags/flag-1', 'feature-flags:write'],
      ['DELETE', '/api/v1/feature-flags/flag-1', 'feature-flags:write'],
      ['GET', '/api/v1/plan-features', 'plan-features:read'],
      ['POST', '/api/v1/plan-features', 'plan-features:write'],
      ['GET', '/api/v1/plan-features/pf-1', 'plan-features:read'],
      ['DELETE', '/api/v1/plan-features/pf-1', 'plan-features:write'],
      ['GET', '/api/v1/plan-limits', 'plan-limits:read'],
      ['POST', '/api/v1/plan-limits', 'plan-limits:write'],
      ['GET', '/api/v1/plan-limits/pl-1', 'plan-limits:read'],
      ['PUT', '/api/v1/plan-limits/pl-1', 'plan-limits:write'],
      ['DELETE', '/api/v1/plan-limits/pl-1', 'plan-limits:write'],
      ['GET', '/api/v1/subscription-plans', 'subscription-plans:read'],
      ['POST', '/api/v1/subscription-plans', 'subscription-plans:write'],
      ['GET', '/api/v1/subscription-plans/sp-1', 'subscription-plans:read'],
      ['PUT', '/api/v1/subscription-plans/sp-1', 'subscription-plans:write'],
      ['DELETE', '/api/v1/subscription-plans/sp-1', 'subscription-plans:write'],
      ['GET', '/api/v1/user-overrides', 'user-overrides:read'],
      ['POST', '/api/v1/user-overrides', 'user-overrides:write'],
      ['GET', '/api/v1/user-overrides/uo-1', 'user-overrides:read'],
      ['PUT', '/api/v1/user-overrides/uo-1', 'user-overrides:write'],
      ['DELETE', '/api/v1/user-overrides/uo-1', 'user-overrides:write'],
      ['GET', '/api/v1/users', 'users:read'],
      ['POST', '/api/v1/users', 'users:write'],
      ['GET', '/api/v1/users/u-1', 'users:read'],
      ['PUT', '/api/v1/users/u-1', 'users:write'],
      ['DELETE', '/api/v1/users/u-1', 'users:write'],
      ['POST', '/api/v1/users/u-1/restore', 'users:write'],
      ['POST', '/api/v1/users/u-1/purge', 'users:purge'],
      ['POST', '/api/v1/users/purge-expired', 'users:purge'],
    ];

    for (const [method, path, expected] of table) {
      expect(requiredScope(method, path), `${method} ${path}`).toBe(expected);
    }
  });

  it('returns null for unknown or non-API paths', () => {
    expect(requiredScope('GET', '/api/v1/whatever')).toBeNull();
    expect(requiredScope('GET', '/api/v1/')).toBeNull();
    expect(requiredScope('GET', '/feature-flags')).toBeNull();
  });

  it('does not invent a write scope for read-only resources', () => {
    expect(requiredScope('POST', '/api/v1/organizations')).toBeNull();
  });

  it('write implies read, purge implies nothing but purge, unknown scopes grant nothing', () => {
    expect(hasScope(new Set(['feature-flags:write']), 'feature-flags:read')).toBe(true);
    expect(hasScope(new Set(['feature-flags:write']), 'feature-flags:write')).toBe(true);
    expect(hasScope(new Set(['feature-flags:read']), 'feature-flags:write')).toBe(false);
    expect(hasScope(new Set(['users:write']), 'users:purge')).toBe(false);
    expect(hasScope(new Set(['users:read', 'users:write']), 'users:purge')).toBe(false);
    expect(hasScope(new Set(['users:purge']), 'users:purge')).toBe(true);
    expect(hasScope(new Set(['feature-flags:*']), 'feature-flags:read')).toBe(false);
    expect(hasScope(new Set(['all']), 'feature-flags:read')).toBe(false);
  });

  it('keeps KNOWN_SCOPES aligned with the scope map values', () => {
    expect(KNOWN_SCOPES.has('users:purge')).toBe(true);
    expect(KNOWN_SCOPES.has('organizations:write')).toBe(false);
  });
});

describe('admin PEM gate — proxy status matrix', () => {
  const ffRead = () => createAdminTestKey('ff-read');
  const usersRead = () => createAdminTestKey('users-read');

  it('lets a signed GET through when the key holds the read scope', async () => {
    const key = ffRead();
    const proxy = await loadProxy({ keys: ring({ key, scopes: ['feature-flags:read'] }) });

    await expectPassed(await proxy(signed(key, '/api/v1/feature-flags')));
  });

  it('denies a path outside the key scopes (users with only feature-flags:read)', async () => {
    const key = ffRead();
    const proxy = await loadProxy({ keys: ring({ key, scopes: ['feature-flags:read'] }) });

    await expectDenied(await proxy(signed(key, '/api/v1/users')), 403, FORBIDDEN);
  });

  it('denies a write with only the read scope', async () => {
    const key = ffRead();
    const proxy = await loadProxy({ keys: ring({ key, scopes: ['feature-flags:read'] }) });

    await expectDenied(
      await proxy(signed(key, '/api/v1/feature-flags', { method: 'POST', body: '{}' })),
      403,
      FORBIDDEN,
    );
  });

  it('denies a key with no scopes', async () => {
    const key = ffRead();
    const proxy = await loadProxy({ keys: ring({ key, scopes: [] }) });

    await expectDenied(await proxy(signed(key, '/api/v1/feature-flags')), 403, FORBIDDEN);
  });

  it('denies an expired key with a valid signature (401)', async () => {
    const key = createAdminTestKey('expired');
    const proxy = await loadProxy({
      keys: ring({ key, scopes: ['feature-flags:read'], expiresAt: '2020-01-01' }),
    });

    await expectDenied(await proxy(signed(key, '/api/v1/feature-flags')), 401, UNAUTHORIZED);
    expect(logger.warn).toHaveBeenCalledWith(
      'admin_api_denied',
      expect.objectContaining({ key_id: 'expired', reason: 'expired', status: 401 }),
    );
  });

  it('denies a request with no signature headers (401)', async () => {
    const key = ffRead();
    const proxy = await loadProxy({ keys: ring({ key, scopes: ['feature-flags:read'] }) });

    await expectDenied(await proxy(request('/api/v1/feature-flags')), 401, UNAUTHORIZED);
  });

  it('denies a signature that no configured key produced (403)', async () => {
    const configured = ffRead();
    const stranger = createAdminTestKey('stranger');
    const proxy = await loadProxy({
      keys: ring({ key: configured, scopes: ['feature-flags:read'] }),
    });

    await expectDenied(await proxy(signed(stranger, '/api/v1/feature-flags')), 403, FORBIDDEN);
  });

  it('denies stale, future and non-numeric timestamps (401)', async () => {
    const key = ffRead();
    const proxy = await loadProxy({ keys: ring({ key, scopes: ['feature-flags:read'] }) });

    const fresh = signAdminRequest({ key, url: '/api/v1/feature-flags' });
    const stale = signAdminRequest({
      key,
      url: '/api/v1/feature-flags',
      timestamp: Date.now() - 6 * 60 * 1000,
    });
    const future = signAdminRequest({
      key,
      url: '/api/v1/feature-flags',
      timestamp: Date.now() + 6 * 60 * 1000,
    });

    for (const headers of [stale, future, { ...fresh, 'x-admin-timestamp': 'not-a-number' }]) {
      await expectDenied(
        await proxy(request('/api/v1/feature-flags', { headers })),
        401,
        UNAUTHORIZED,
      );
    }
  });

  it('binds the query string (tampering fails, reordering passes)', async () => {
    const key = usersRead();
    const proxy = await loadProxy({ keys: ring({ key, scopes: ['users:read'] }) });

    const headers = signAdminRequest({
      key,
      url: '/api/v1/users?status=active&page=2',
    });

    // Re-ordered params canonicalise to the same string → allowed.
    await expectPassed(await proxy(request('/api/v1/users?page=2&status=active', { headers })));

    // A different filter does not verify → 403.
    await expectDenied(
      await proxy(request('/api/v1/users?page=2&status=active&search=x', { headers })),
      403,
      FORBIDDEN,
    );
  });

  it('binds the request body', async () => {
    const key = createAdminTestKey('ff-write');
    const proxy = await loadProxy({
      keys: ring({ key, scopes: ['feature-flags:write', 'feature-flags:read'] }),
    });

    const body = '{"enabled":false}';
    const headers = signAdminRequest({
      key,
      url: '/api/v1/feature-flags',
      method: 'POST',
      body,
    });

    await expectPassed(
      await proxy(request('/api/v1/feature-flags', { method: 'POST', headers, body })),
    );

    await expectDenied(
      await proxy(
        request('/api/v1/feature-flags', {
          method: 'POST',
          headers,
          body: '{"enabled":true}',
        }),
      ),
      403,
      FORBIDDEN,
    );
  });

  it('splits users read / write / purge', async () => {
    const readKey = createAdminTestKey('users-read');
    const writeKey = createAdminTestKey('users-write');
    const purgeKey = createAdminTestKey('users-purge');
    const keys = ring(
      { key: readKey, scopes: ['users:read'] },
      { key: writeKey, scopes: ['users:write'] },
      { key: purgeKey, scopes: ['users:purge'] },
    );
    const proxy = await loadProxy({ keys });

    const deletePath = '/api/v1/users/user-1';
    await expectDenied(
      await proxy(signed(readKey, deletePath, { method: 'DELETE' })),
      403,
      FORBIDDEN,
    );
    await expectPassed(await proxy(signed(writeKey, deletePath, { method: 'DELETE' })));

    const purgePath = '/api/v1/users/user-1/purge';
    await expectDenied(
      await proxy(signed(writeKey, purgePath, { method: 'POST', body: '' })),
      403,
      FORBIDDEN,
    );
    await expectPassed(await proxy(signed(purgeKey, purgePath, { method: 'POST', body: '' })));

    const purgeExpired = '/api/v1/users/purge-expired';
    await expectDenied(
      await proxy(signed(writeKey, purgeExpired, { method: 'POST', body: '' })),
      403,
      FORBIDDEN,
    );
    await expectPassed(await proxy(signed(purgeKey, purgeExpired, { method: 'POST', body: '' })));
  });

  it('keeps the valid key working when another entry is malformed', async () => {
    const valid = ffRead();
    const keys = JSON.stringify([
      { id: 'broken', key: 'not-a-key', scopes: ['feature-flags:read'] },
      ringEntry(valid, { scopes: ['feature-flags:read'] }),
    ]);
    const proxy = await loadProxy({ keys });

    await expectPassed(await proxy(signed(valid, '/api/v1/feature-flags')));
    expect(logger.warn).toHaveBeenCalledWith(
      'admin_pem_key_rejected',
      expect.objectContaining({ index: 0, key_id: 'broken' }),
    );
  });

  it('fails closed in every environment when a non-empty ring has no valid entries', async () => {
    for (const nodeEnv of ['development', 'production', 'test']) {
      const proxy = await loadProxy({ keys: '{not-json', nodeEnv });
      await expectDenied(await proxy(request('/api/v1/feature-flags')), 401, UNAUTHORIZED);
      expect(logger.error).toHaveBeenCalledWith('admin_pem_keyring_empty', expect.any(Object));
      logger.error.mockClear();
    }
  });

  it('fails closed with an empty ring in production but keeps the dev bypass', async () => {
    const prod = await loadProxy({ keys: undefined, nodeEnv: 'production' });
    await expectDenied(await prod(request('/api/v1/feature-flags')), 401, UNAUTHORIZED);

    const dev = await loadProxy({ keys: '', nodeEnv: 'development' });
    await expectPassed(await dev(request('/api/v1/feature-flags')));
  });

  it('passes UI pages through regardless of the ring', async () => {
    const proxy = await loadProxy({ keys: undefined, nodeEnv: 'production' });
    await expectPassed(await proxy(request('/feature-flags')));
  });

  it('denies an unknown /api/v1 path even with a valid signature', async () => {
    const key = ffRead();
    const proxy = await loadProxy({ keys: ring({ key, scopes: ['feature-flags:read'] }) });

    await expectDenied(await proxy(signed(key, '/api/v1/whatever')), 403, FORBIDDEN);
    expect(logger.warn).toHaveBeenCalledWith(
      'admin_api_denied',
      expect.objectContaining({ reason: 'unknown_path', status: 403 }),
    );
  });

  it('forwards the verified key id and overwrites an inbound value', async () => {
    const key = ffRead();
    const proxy = await loadProxy({ keys: ring({ key, scopes: ['feature-flags:read'] }) });

    const res = await proxy(
      signed(key, '/api/v1/feature-flags', {
        headers: { 'x-admin-key-id': 'forged' },
      }),
    );

    await expectPassed(res);
    expect(res.headers.get('x-middleware-request-x-admin-key-id')).toBe('ff-read');
    expect(res.headers.get('x-middleware-override-headers')).toContain('x-admin-key-id');
  });

  it('emits exactly one audit record with no signature, body or query', async () => {
    const key = usersRead();
    const proxy = await loadProxy({ keys: ring({ key, scopes: ['users:read'] }) });

    const res = await proxy(
      signed(key, '/api/v1/users?search=alice%40example.com&page=1', {
        headers: { 'x-admin-key-id': 'forged' },
      }),
    );
    await expectPassed(res);

    expect(logger.log).toHaveBeenCalledTimes(1);
    const [message, attributes] = logger.log.mock.calls[0] as [string, Record<string, unknown>];
    expect(message).toBe('admin_api_request');
    expect(attributes).toEqual({
      key_id: 'users-read',
      method: 'GET',
      path: '/api/v1/users',
      decision: 'allow',
    });
    const serialised = JSON.stringify(attributes);
    expect(serialised).not.toMatch(/search|alice|signature|x-admin/i);
  });
});
