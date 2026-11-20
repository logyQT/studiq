/**
 * Guard for the public API inventory (#704).
 *
 * `apps/web/src/proxy.ts` returns for every `/api/*` request before `routeRules`
 * is consulted, so a handler is protected only by its own `withAuth()`. That
 * made the old `/api/*` rules in `routes.config.ts` unreachable prose, and the
 * list of "unprotected by design" prefixes had drifted from the handlers.
 *
 * These tests replace that prose with something the pre-push hook enforces:
 * a route file outside `PUBLIC_API` must wrap **every** exported HTTP handler in
 * `withAuth()` (a file-wide search passes as soon as one handler is gated),
 * every declaration must still describe a real route, and no route rule may
 * claim an API path (which would be dead code again).
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

const HTTP_METHOD_NAMES = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

const HANDLER_DECLARATION = /export\s+(?:async\s+)?(?:function|const)\s+([A-Za-z_$][\w$]*)/g;

/** An exported HTTP handler, with the source between it and the next declaration. */
type Handler = { name: string; body: string };

function exportedHandlers(source: string): Handler[] {
  const declarations = [...source.matchAll(HANDLER_DECLARATION)].filter((match) =>
    HTTP_METHOD_NAMES.has(match[1] ?? ''),
  );

  return declarations.map((match, index) => ({
    name: String(match[1]),
    body: source.slice(match.index, declarations[index + 1]?.index ?? source.length),
  }));
}

/** The exported handlers of `source` that show no gate of their own. */
function ungatedHandlers(source: string): string[] {
  return exportedHandlers(source)
    .filter((handler) => !isGated(handler.body))
    .map((handler) => handler.name);
}

/**
 * Route helpers that call `withAuth()` themselves, mapped to the module that
 * implements them. A handler built from one is gated even though the route file
 * never names `withAuth`; the last test proves each entry really gates.
 */
const GATED_FACTORIES: Record<string, string> = {
  authedRoute: 'packages/server/src/lib/route-handler.ts',
  authedRouteWithParams: 'packages/server/src/lib/route-handler.ts',
  batchActionRoute: 'packages/server/src/lib/batch-action-route.ts',
  itemFlagRoute: 'packages/server/src/lib/item-flag-route.ts',
};

function isGated(body: string): boolean {
  return (
    body.includes('withAuth(') ||
    Object.keys(GATED_FACTORIES).some((factory) => new RegExp(`\\b${factory}\\s*[<(]`).test(body))
  );
}

/** Every unprotected handler on a route outside `PUBLIC_API`, as `file (url) HANDLER`. */
function unlistedHandlers(candidates: ApiRoute[]): string[] {
  return candidates
    .filter((route) => !isDeclaredPublic(route.urlPath))
    .flatMap((route) =>
      ungatedHandlers(route.source).map((handler) => `${route.file} (${route.urlPath}) ${handler}`),
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
    expect(
      unlistedHandlers(routes),
      'Every exported HTTP handler must be wrapped in withAuth() — or its group declared in PUBLIC_API (packages/server/src/config/routes.config.ts).',
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

  it('every gated factory really calls withAuth() in its own module', () => {
    const sources = Object.fromEntries(
      Object.entries(GATED_FACTORIES).map(([factory, file]) => [
        factory,
        fs.readFileSync(path.join(process.cwd(), file), 'utf8'),
      ]),
    );
    for (const [factory, file] of Object.entries(GATED_FACTORIES)) {
      const source = sources[factory]!;
      expect(source, `${file} is listed as a gated factory`).toMatch(
        new RegExp(`function ${factory}\\s*[<(]`),
      );
      // A factory may delegate to another gated factory (2b-6: itemFlagRoute is
      // the authedRouteWithParams shape), but the chain must end at withAuth.
      const delegates = Object.keys(GATED_FACTORIES).some(
        (other) => other !== factory && new RegExp(`\\b${other}\\s*[<(]`).test(source),
      );
      expect(
        source.includes('withAuth(') || delegates,
        `${file} must wrap its handler in withAuth() or delegate to a gated factory`,
      ).toBe(true);
    }
  });
});

const GATED_PAIR = `
import { withAuth } from '@studiq/server/lib/with-auth';

export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) => toNextResponse(await flashcards.list(ctx)));
}

export async function POST(req: NextRequest) {
  return withAuth(req, async (ctx) => toNextResponse(await flashcards.create(ctx)));
}
`;

const HALF_GATED_PAIR = `
import { withAuth } from '@studiq/server/lib/with-auth';

export async function GET(req: NextRequest) {
  return withAuth(req, async (ctx) => toNextResponse(await flashcards.list(ctx)));
}

export async function DELETE(req: NextRequest) {
  return Response.json({ ok: true, deletedAll: req.url });
}
`;

const UNGATED_ROUTE = `
export async function GET() {
  return Response.json({ ok: true });
}
`;

const FACTORY_GATED_ROUTE = `
import { batchActionRoute } from '@studiq/server/lib/batch-action-route';

export const POST = batchActionRoute({ delete: (body, ctx) => topics.batchDelete(body, ctx) });
`;

const UNKNOWN_FACTORY_ROUTE = `
import { publicRoute } from '@studiq/server/lib/somewhere';

export const GET = publicRoute({ list: () => [] });
`;

describe('ungatedHandlers()', () => {
  it('passes a file whose two handlers are both gated', () => {
    expect(ungatedHandlers(GATED_PAIR)).toEqual([]);
  });

  it('reports the handler a file-wide search would have let through', () => {
    expect(ungatedHandlers(HALF_GATED_PAIR)).toEqual(['DELETE']);
  });

  it('reports every handler of an ungated file', () => {
    expect(ungatedHandlers(UNGATED_ROUTE)).toEqual(['GET']);
  });

  it('treats a handler built from a declared gated factory as gated', () => {
    expect(ungatedHandlers(FACTORY_GATED_ROUTE)).toEqual([]);
  });

  it('reports a handler built from a factory that is not known to gate', () => {
    expect(ungatedHandlers(UNKNOWN_FACTORY_ROUTE)).toEqual(['GET']);
  });

  it('leaves a declared-public route alone', () => {
    const findings = unlistedHandlers([
      {
        file: 'apps/web/src/app/(backend)/api/v1/health/route.ts',
        urlPath: '/api/v1/health',
        source: UNGATED_ROUTE,
      },
    ]);

    expect(findings).toEqual([]);
  });

  it('names the file, the URL and the ungated handler', () => {
    const findings = unlistedHandlers([
      {
        file: 'apps/web/src/app/(backend)/api/v1/flashcards/route.ts',
        urlPath: '/api/v1/flashcards',
        source: HALF_GATED_PAIR,
      },
    ]);

    expect(findings).toEqual([
      'apps/web/src/app/(backend)/api/v1/flashcards/route.ts (/api/v1/flashcards) DELETE',
    ]);
  });
});
