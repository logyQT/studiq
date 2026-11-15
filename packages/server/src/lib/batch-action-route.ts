import type { RequestContext } from '@studiq/authz';
import type { ControllerResponse } from '@studiq/server/lib/controller-response';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

export type BatchActionHandler = (
  body: unknown,
  ctx: RequestContext,
) => Promise<ControllerResponse>;

/**
 * `POST /…/batch/[action]` handler for a controller's bulk operations: the
 * `action` segment selects the handler and an unknown action is a 400. Every
 * collection exposes the same dispatch, so it lives here rather than being
 * copied into each route file.
 */
export function batchActionRoute(handlers: Record<string, BatchActionHandler>) {
  return async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ action: string }> },
  ) {
    return withAuth(req, async (ctx) => {
      const { action } = await params;
      // Own properties only: `handlers['constructor']` would otherwise resolve
      // `Object.prototype` and dispatch it as if it were a batch action.
      const handler = Object.hasOwn(handlers, action) ? handlers[action] : undefined;
      if (!handler) {
        return toNextResponse({
          success: false as const,
          statusCode: 400,
          error: 'BAD_REQUEST' as const,
        });
      }
      const body: unknown = await req.json();
      return toNextResponse(await handler(body, ctx));
    });
  };
}
