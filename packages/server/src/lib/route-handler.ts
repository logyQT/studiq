import type { RequestContext } from '@studiq/authz';
import type { ControllerResponse } from '@studiq/server/lib/controller-response';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth, type WithAuthOptions } from '@studiq/server/lib/with-auth';
import type { NextRequest, NextResponse } from 'next/server';

/**
 * What a route hands its controller: the path's params (`undefined` for a
 * handler with no `[param]` segment) and the parsed body. `read` builds the
 * controller's arguments from it.
 */
export interface RouteInput<Params> {
  params: Params;
  json: unknown;
}

type RouteController<Body extends unknown[]> = (
  ctx: RequestContext,
  ...rest: Body
) => Promise<ControllerResponse>;

/** What a route declares about the request beyond the caller's identity. */
export interface RouteOptions extends WithAuthOptions {
  /**
   * The handler consumes a JSON body. Off by default, because a method may
   * legitimately carry none — reading an empty stream throws, and that 400 would
   * pre-empt the controller's own answer (a `DELETE` refused with 403).
   */
  readsBody?: boolean;
}

/**
 * The route layer's repeated shape: resolve the caller through `withAuth`, read
 * what the body and path carry, call the controller, shape one response with
 * `toNextResponse`.
 *
 * `readsBody` is the route's own declaration that it consumes a body, not a guess
 * from the method: a `DELETE` that takes none must not have `req.json()` run on
 * it, or an empty stream becomes a parse error (400) in front of the controller's
 * own 403. Authentication runs first, so an unauthenticated caller never has its
 * body parsed; authority is the controller's check and runs after it, so an
 * authenticated caller without the permission whose JSON is malformed gets 400
 * from the parse rather than the controller's 403. Throwing stays the
 * controller's error path — `withAuth`'s instrumentation turns an `AppError`
 * into the envelope, so nothing here catches.
 */
async function respond<Body extends unknown[]>(
  req: NextRequest,
  readsBody: boolean,
  read: (json: unknown) => [...Body],
  call: RouteController<Body>,
  options?: WithAuthOptions,
): Promise<NextResponse | Response> {
  return withAuth(
    req,
    async (ctx) => {
      const json: unknown = readsBody ? await req.json() : undefined;
      return toNextResponse(await call(ctx, ...read(json)));
    },
    options,
  );
}

/** For a path with no `[param]` segment: Next passes the request alone. */
export function authedRoute<Body extends unknown[] = []>(
  read: (input: RouteInput<undefined>) => [...Body],
  call: RouteController<Body>,
  route: RouteOptions = {},
) {
  return async (req: NextRequest): Promise<NextResponse | Response> =>
    respond(
      req,
      route.readsBody ?? false,
      (json) => read({ params: undefined, json }),
      call,
      route,
    );
}

/**
 * For a path with an `[id]`. The route passes the params through, so the
 * handler's own signature is where their type comes from — the wrapper only
 * waits for the promise.
 */
export function authedRouteWithParams<
  Params extends Record<string, string>,
  Body extends unknown[] = [],
>(
  read: (input: RouteInput<Params>) => [...Body],
  call: RouteController<Body>,
  route: RouteOptions = {},
) {
  return async (
    req: NextRequest,
    context: { params: Promise<Params> },
  ): Promise<NextResponse | Response> => {
    const params = await context.params;
    return respond(req, route.readsBody ?? false, (json) => read({ params, json }), call, route);
  };
}
