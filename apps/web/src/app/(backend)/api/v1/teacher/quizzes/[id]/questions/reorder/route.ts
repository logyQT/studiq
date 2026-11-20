import { quizTeacherController } from '@studiq/server/controllers/quiz-teacher.controller';
import { authedRouteWithParams } from '@studiq/server/lib/route-handler';

/** Reorders one quiz's items; the parent's `quiz.update` gates in the controller. */
export const PUT = authedRouteWithParams<{ id: string }, [{ id: string }, unknown]>(
  ({ params, json }) => [params, json],
  (ctx, params, body) => quizTeacherController.reorderQuestions(params.id, body, ctx),
  { readsBody: true },
);
