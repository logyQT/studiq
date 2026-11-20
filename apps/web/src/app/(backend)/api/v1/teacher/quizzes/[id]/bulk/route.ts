import { quizTeacherController } from '@studiq/server/controllers/quiz-teacher.controller';
import { authedRouteWithParams } from '@studiq/server/lib/route-handler';

/** Replaces the whole item set of one quiz; the parent's `quiz.update` gates in the controller. */
export const PUT = authedRouteWithParams<{ id: string }, [unknown, string]>(
  ({ params, json }) => [json, params.id],
  (ctx, body, id) => quizTeacherController.bulkSave(id, body, ctx),
  { readsBody: true },
);
