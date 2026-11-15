import { topicController } from '@studiq/server/controllers/topic.controller';
import { batchActionRoute } from '@studiq/server/lib/batch-action-route';

export const POST = batchActionRoute({
  delete: (body, ctx) => topicController.batchDelete(body, ctx),
  create: (body, ctx) => topicController.bulkCreate(body, ctx),
});
