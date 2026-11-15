import { questionBankController } from '@studiq/server/controllers/question-bank.controller';
import { batchActionRoute } from '@studiq/server/lib/batch-action-route';

export const POST = batchActionRoute({
  delete: (body, ctx) => questionBankController.batchDelete(body, ctx),
  create: (body, ctx) => questionBankController.bulkCreate(body, ctx),
});
