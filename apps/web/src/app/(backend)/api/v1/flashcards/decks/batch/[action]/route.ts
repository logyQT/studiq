import { flashcardDeckController } from '@studiq/server/controllers/flashcard-deck.controller';
import { batchActionRoute } from '@studiq/server/lib/batch-action-route';

export const POST = batchActionRoute({
  delete: (body, ctx) => flashcardDeckController.batchDelete(body, ctx),
  create: (body, ctx) => flashcardDeckController.bulkCreate(body, ctx),
  suspend: (body, ctx) => flashcardDeckController.batchToggleSuspend(body, ctx),
});
