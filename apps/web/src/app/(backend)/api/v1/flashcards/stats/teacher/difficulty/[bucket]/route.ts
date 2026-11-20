import { flashcardStatsController } from '@studiq/server/controllers/flashcard-stats.controller';
import { authedRouteWithParams } from '@studiq/server/lib/route-handler';

type Params = { bucket: string };

/** The cards of one difficulty bucket; `stats.read` gates in the controller. */
export const GET = authedRouteWithParams<Params, [string]>(
  ({ params }) => [params.bucket],
  (ctx, bucket) => flashcardStatsController.getDifficultyCards({ bucket }, ctx),
);
