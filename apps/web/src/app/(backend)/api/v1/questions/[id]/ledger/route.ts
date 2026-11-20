import { questionController } from '@studiq/server/controllers/question.controller';
import { authedRouteWithParams } from '@studiq/server/lib/route-handler';

type Params = { id: string };

/**
 * The staff ledger of one item (R8): who the system showed its key to, when, and with which
 * classes. The controller gates the staff key from the context and the service resolves it
 * against the loaded row — a foreign-org id is 404, and the payload carries no key field.
 */
export const GET = authedRouteWithParams<Params, [string]>(
  ({ params }) => [params.id],
  (ctx, id) => questionController.ledger(id, ctx),
);
