import { quizTeacherController } from '@studiq/server/controllers/quiz-teacher.controller';
import { authedRouteWithParams } from '@studiq/server/lib/route-handler';

type Params = { id: string; questionId: string };

/** Removes one item from a quiz; the parent's `quiz.update` gates in the controller. */
export const DELETE = authedRouteWithParams<Params, [string, string]>(
  ({ params }) => [params.id, params.questionId],
  (ctx, id, questionId) => quizTeacherController.removeQuestion(id, questionId, ctx),
);
