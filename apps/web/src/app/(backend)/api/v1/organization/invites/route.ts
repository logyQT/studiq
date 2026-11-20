import { invitationController } from '@studiq/server/controllers/invitation.controller';
import { authedRoute } from '@studiq/server/lib/route-handler';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import type { NextRequest } from 'next/server';

/**
 * `?token=…` is the public preview (the token is the capability; the accept flow
 * runs before the caller is a member), so it stays unauthenticated and outside
 * the wrapper. Everything else is the authenticated list — built inline, after
 * that branch, because the file cannot export two GETs.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');

  if (token) {
    return toNextResponse(await invitationController.getByToken(token));
  }

  return authedRoute(
    () => [],
    (ctx) =>
      invitationController.list(ctx, {
        isAccepted: new URL(ctx.url).searchParams.get('isAccepted') === 'true',
      }),
  )(req);
}

/** Create keeps its own authority until 2b-4 rewrites the invitation grant. */
export const POST = authedRoute(
  ({ json }) => [json],
  (ctx, body) => invitationController.create(ctx, body),
  { readsBody: true },
);
