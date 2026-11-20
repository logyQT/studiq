import { quizTeacherController } from '@studiq/server/controllers/quiz-teacher.controller';
import { authedRouteWithParams } from '@studiq/server/lib/route-handler';

/** Adds items to one quiz; the parent's `quiz.update` gates in the controller. */
export const POST = authedRouteWithParams<{ id: string }, [unknown, string]>(
  ({ params, json }) => [json, params.id],
  (ctx, body, id) => quizTeacherController.addQuestions(id, body, ctx),
  { readsBody: true },
);
