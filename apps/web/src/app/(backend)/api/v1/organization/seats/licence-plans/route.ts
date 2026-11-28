import { seatController } from '@studiq/server/controllers/seat.controller';
import { authedRoute } from '@studiq/server/lib/route-handler';

/** The licence tier cards and the pool names on `/manage/seats`: `org.seat.manage`. */
export const GET = authedRoute(
  () => [],
  (ctx) => seatController.listLicencePlans(ctx),
);
