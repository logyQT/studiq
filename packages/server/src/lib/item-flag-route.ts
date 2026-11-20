import type { RequestContext } from '@studiq/authz';
import type { ControllerResponse } from '@studiq/server/lib/controller-response';
import { authedRouteWithParams } from '@studiq/server/lib/route-handler';

export type ItemFlagHandler = (
  id: string,
  questionId: string,
  body: unknown,
  ctx: RequestContext,
) => Promise<ControllerResponse>;

/**
 * `PUT`/`PATCH …/questions/:questionId/<flag>` for a teacher's per-item decisions (the review
 * hold, the taught declaration). Both flags take the same id, body and `assignment.update`
 * gate, so the wrapper lives here instead of being copied into the route file: it is the
 * shared `authedRouteWithParams` shape, and the persona gate the route used to carry is gone
 * (ADR-0015 §7) — the controller decides from the context.
 */
export function itemFlagRoute(action: ItemFlagHandler) {
  return authedRouteWithParams<{ id: string; questionId: string }, [string, string, unknown]>(
    ({ params, json }) => [params.id, params.questionId, json],
    (ctx, id, questionId, body) => action(id, questionId, body, ctx),
    { readsBody: true },
  );
}
