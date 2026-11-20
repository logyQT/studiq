import { flashcardStatsController } from '@studiq/server/controllers/flashcard-stats.controller';
import { authedRoute } from '@studiq/server/lib/route-handler';

/** Flashcard stats of the caller's decks; `stats.read` gates in the controller. */
export const GET = authedRoute(
  () => [],
  (ctx) =>
    flashcardStatsController.getTeacherStats(
      Object.fromEntries(new URL(ctx.url).searchParams),
      ctx,
    ),
);
