import { flashcardController } from '@studiq/server/controllers/flashcard.controller';
import { flashcardPracticeController } from '@studiq/server/controllers/flashcard-practice.controller';
import { batchActionRoute } from '@studiq/server/lib/batch-action-route';

export const POST = batchActionRoute({
  copy: (body, ctx) => flashcardController.batchCopy(body, ctx),
  delete: (body, ctx) => flashcardController.batchDelete(body, ctx),
  topics: (body, ctx) => flashcardController.batchTopics(body, ctx),
  move: (body, ctx) => flashcardController.batchMove(body, ctx),
  practice: (body, ctx) => flashcardPracticeController.batch(body, ctx),
  create: (body, ctx) => flashcardController.bulkCreate(body, ctx),
});
