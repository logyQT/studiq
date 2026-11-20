import { quizTeacherController } from '@studiq/server/controllers/quiz-teacher.controller';
import { authedRoute } from '@studiq/server/lib/route-handler';

/** The quizzes `quiz.read` reaches; the key gates in the controller. */
export const GET = authedRoute(
  () => [],
  (ctx) => quizTeacherController.list(ctx),
);

/** Creates one in the active org; `quiz.create` gates in the controller. */
export const POST = authedRoute(
  ({ json }) => [json],
  (ctx, body) => quizTeacherController.create(body, ctx),
  { readsBody: true },
);
