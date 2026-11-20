import { seatController } from '@studiq/server/controllers/seat.controller';
import { authedRoute } from '@studiq/server/lib/route-handler';

/** The pool list is the `/manage/seats` read: `org.seat.manage`. */
export const GET = authedRoute(
  () => [],
  (ctx) => seatController.listPools(ctx),
);

export const POST = authedRoute(
  ({ json }) => [json],
  (ctx, body) => seatController.createPool(ctx, body),
  { readsBody: true },
);
