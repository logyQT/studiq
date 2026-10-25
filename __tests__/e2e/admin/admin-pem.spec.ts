/**
 * End-to-end coverage of the admin PEM gate on a real `:4000` server.
 *
 * The ring is injected by `playwright.config.ts` (deterministic keypair, only
 * `feature-flags:read`). Requests use Playwright's `request` fixture because the
 * browser cannot sign — the gate is an HTTP boundary, not a UI one.
 *
 * Scope is deliberately GET-only: config must never be mutated.
 */
import { expect, test } from '@playwright/test';
import { deterministicAdminTestKey, signAdminRequest } from '#test/helpers/admin-pem';

const key = deterministicAdminTestKey('e2e-admin');

test.describe('admin PEM gate', () => {
  test('a signed GET reaches the route handler and returns data', async ({ request }) => {
    const url = '/api/v1/feature-flags';
    const response = await request.get(url, {
      headers: signAdminRequest({ key, url }),
    });

    expect(response.status()).toBe(200);

    const body = (await response.json()) as { success?: boolean; data?: unknown };
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('a scope miss is 403 and exposes no records', async ({ request }) => {
    const url = '/api/v1/users';
    const response = await request.get(url, {
      headers: signAdminRequest({ key, url }),
    });

    expect(response.status()).toBe(403);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'ERROR_FORBIDDEN',
    });
  });

  test('an unsigned request is 401', async ({ request }) => {
    const response = await request.get('/api/v1/feature-flags');

    expect(response.status()).toBe(401);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'ERROR_UNAUTHORIZED',
    });
  });
});
