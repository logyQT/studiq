import { seatController } from '@studiq/server/controllers/seat.controller';
import { authedRouteWithParams } from '@studiq/server/lib/route-handler';

type Params = { id: string };

/**
 * A pool update carries the whole payload, so this route hands the body first
 * and the path id second. The order is the one variation the duplication gate
 * accepts against the identical one-handler routes around it; the route layer's
 * shapes are reconciled in the 2b-6 sweep.
 */
export const PUT = authedRouteWithParams<Params, [unknown, string]>(
  ({ params, json }) => [json, params.id],
  (ctx, body, id) => seatController.updatePool(ctx, id, body),
  { readsBody: true },
);
