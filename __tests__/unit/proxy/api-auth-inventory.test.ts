/**
 * Guard for the public API inventory (#704).
 *
 * `apps/web/src/proxy.ts` returns for every `/api/*` request before `routeRules`
 * is consulted, so a handler is protected only by its own `withAuth()`. That
 * made the old `/api/*` rules in `routes.config.ts` unreachable prose, and the
 * list of "unprotected by design" prefixes had drifted from the handlers.
 *
 * These tests replace that prose with something the pre-push hook enforces:
 * a route file without `withAuth()` must be declared in `PUBLIC_API`, every
 * declaration must still describe a real route, and no route rule may claim an
 * API path (which would be dead code again).
 */

import fs from 'node:fs';
import path from 'node:path';
import { PUBLIC_API, routeRules } from '@studiq/server/config/routes.config';
import { describe, expect, it } from 'vitest';

const API_ROOT = path.join(process.cwd(), 'apps/web/src/app/(backend)/api');

type ApiRoute = { file: string; urlPath: string; source: string };

function apiRoutes(): ApiRoute[] {
  const routes: ApiRoute[] = [];

  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(target);
        continue;
      }
      if (entry.name !== 'route.ts') continue;

      const relative = path.relative(API_ROOT, directory).split(path.sep).join('/');
      routes.push({
        file: path.relative(process.cwd(), target).split(path.sep).join('/'),
        urlPath: relative ? `/api/${relative}` : '/api',
        source: fs.readFileSync(target, 'utf8'),
      });
    }
  };

  walk(API_ROOT);
  return routes.toSorted((a, b) => a.urlPath.localeCompare(b.urlPath));
}

function isDeclaredPublic(urlPath: string): boolean {
  if (new Set<string>(PUBLIC_API.exact).has(urlPath)) return true;
  return PUBLIC_API.prefixes.some(
    (prefix) => urlPath === prefix || urlPath.startsWith(`${prefix}/`),
  );
}

const routes = apiRoutes();

describe('API auth inventory', () => {
  it('finds both gated and declared-open handlers', () => {
    const urlPaths = routes.map((route) => route.urlPath);
    expect(urlPaths).toEqual(
      expect.arrayContaining(['/api/v1/flashcards', '/api/v1/health', '/api/v1/stripe/webhook']),
    );
  });

  it('every handler calls withAuth(), or its group is declared in PUBLIC_API', () => {
    const unlisted = routes
      .filter((route) => !route.source.includes('withAuth('))
      .filter((route) => !isDeclaredPublic(route.urlPath))
      .map((route) => `${route.file} (${route.urlPath})`);

    expect(
      unlisted,
      'Unprotected handlers must be declared in PUBLIC_API (packages/server/src/config/routes.config.ts) — or wrapped in withAuth().',
    ).toEqual([]);
  });

  it('every PUBLIC_API entry still matches a real route', () => {
    const staleExact = PUBLIC_API.exact.filter(
      (exact) => !routes.some((route) => route.urlPath === exact),
    );
    const stalePrefixes = PUBLIC_API.prefixes.filter(
      (prefix) =>
        !routes.some((route) => route.urlPath === prefix || route.urlPath.startsWith(`${prefix}/`)),
    );

    expect({ staleExact, stalePrefixes }).toEqual({ staleExact: [], stalePrefixes: [] });
  });

  it('no route rule claims an API path — the proxy never applies rules to /api/*', () => {
    const deadRules = routeRules
      .filter((rule) => routes.some((route) => rule.matcher.test(route.urlPath)))
      .map((rule) => rule.matcher.source);

    expect(
      deadRules,
      'Remove the rule: apps/web/src/proxy.ts returns before routeRules for /api/*, so it can never run.',
    ).toEqual([]);
  });
});
