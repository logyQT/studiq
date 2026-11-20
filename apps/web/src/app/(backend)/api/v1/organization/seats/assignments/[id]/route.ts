import { seatController } from '@studiq/server/controllers/seat.controller';
import { authedRouteWithParams } from '@studiq/server/lib/route-handler';

type Params = { id: string };

/** A DELETE with no body: refused callers get 403, never a 400 from an empty stream. */
export const DELETE = authedRouteWithParams<Params, [string]>(
  ({ params }) => [params.id],
  (ctx, id) => seatController.unassignSeat(ctx, id),
);
