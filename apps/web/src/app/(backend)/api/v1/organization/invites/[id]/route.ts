import { invitationController } from '@studiq/server/controllers/invitation.controller';
import { authedRouteWithParams } from '@studiq/server/lib/route-handler';

type Params = { id: string };

/** Retarget and revoke are `org.invitation.manage`; the controller owns the key. */
export const PUT = authedRouteWithParams<Params, [string, unknown]>(
  ({ params, json }) => [params.id, json],
  (ctx, id, body) => invitationController.update(ctx, id, body),
  { readsBody: true },
);

export const DELETE = authedRouteWithParams<Params, [string]>(
  ({ params }) => [params.id],
  (ctx, id) => invitationController.delete(ctx, id),
);
