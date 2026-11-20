import { seatController } from '@studiq/server/controllers/seat.controller';
import { authedRoute } from '@studiq/server/lib/route-handler';

export const GET = authedRoute(
  () => [],
  (ctx) => seatController.listAssignments(ctx),
);

export const POST = authedRoute(
  ({ json }) => [json],
  (ctx, body) => seatController.assignSeat(ctx, body),
  { readsBody: true },
);
