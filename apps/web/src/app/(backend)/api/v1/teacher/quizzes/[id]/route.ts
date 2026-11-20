import { quizTeacherController } from '@studiq/server/controllers/quiz-teacher.controller';
import { authedRouteWithParams } from '@studiq/server/lib/route-handler';

/** Reads one quiz; `quiz.read` gates in the controller, resolved against the loaded row. */
export const GET = authedRouteWithParams<{ id: string }, [string]>(
  ({ params }) => [params.id],
  (ctx, id) => quizTeacherController.getById(id, ctx),
);

/** Edits the quiz's name/description; `quiz.update` gates in the controller. */
export const PUT = authedRouteWithParams<{ id: string }, [string, unknown]>(
  ({ params, json }) => [params.id, json],
  (ctx, id, body) => quizTeacherController.update(id, body, ctx),
  { readsBody: true },
);

/** Deleting has no body: the id is the whole input. `quiz.delete` gates in the controller. */
export const DELETE = authedRouteWithParams<{ id: string }, [string]>(
  ({ params }) => [params.id],
  (ctx, id) => quizTeacherController.delete(id, ctx),
);
