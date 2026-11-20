import { quizTeacherController } from '@studiq/server/controllers/quiz-teacher.controller';
import { authedRouteWithParams } from '@studiq/server/lib/route-handler';

/**
 * Mints an assignment from one quiz. The child acts on the parent quiz's `quiz.update`
 * key (resolved against the loaded row, so a foreign id is 404); the minted assignment is
 * an `assignment.create` write, which the controller asks for as well.
 */
export const POST = authedRouteWithParams<{ id: string }, [string]>(
  ({ params }) => [params.id],
  (ctx, id) => quizTeacherController.createAssignment(id, ctx),
);
