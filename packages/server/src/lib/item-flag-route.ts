import type { RequestContext } from '@studiq/authz';
import { AccountType } from '@studiq/authz';
import type { ControllerResponse } from '@studiq/server/lib/controller-response';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

export type ItemFlagHandler = (
  id: string,
  questionId: string,
  body: unknown,
  ctx: RequestContext,
) => Promise<ControllerResponse>;

/**
 * `PUT`/`PATCH …/questions/:questionId/<flag>` for a teacher's per-item decisions (the review hold,
 * the taught declaration). Every flag takes the same id, body and staff gate, so the wrapper lives
 * here instead of being copied into each route file.
 */
export function itemFlagRoute(
  req: NextRequest,
  params: Promise<{ id: string; questionId: string }>,
  action: ItemFlagHandler,
) {
  return withAuth(
    req,
    async (ctx) => {
      const { id, questionId } = await params;
      const body: unknown = await req.json();
      return toNextResponse(await action(id, questionId, body, ctx));
    },
    { allowedAccountTypes: [AccountType.EDUCATOR, AccountType.MANAGER] },
  );
}
