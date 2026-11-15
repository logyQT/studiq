import { AccountType, type RequestContext } from '@studiq/authz';
import { teacherAssignmentController } from '@studiq/server/controllers/teacher-assignment.controller';
import type { ControllerResponse } from '@studiq/server/lib/controller-response';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

/**
 * The lifecycle actions on one assessment (#1174, R12/R19). They are one decision — what happens to
 * the run — so they share a handler the way the batch actions do.
 *
 * `cancel` ends a scheduled or live run without a reveal. `extend` and the manager `override` join it
 * in the next PR of the stack, which is why the segment is an action rather than a fixed path.
 */
interface LifecycleAction {
  run: (id: string, body: unknown, ctx: RequestContext) => Promise<ControllerResponse>;
  allowedAccountTypes: AccountType[];
}

const ACTIONS: Record<string, LifecycleAction> = {
  cancel: {
    run: (id, _body, ctx) => teacherAssignmentController.cancel(id, ctx),
    allowedAccountTypes: [AccountType.EDUCATOR, AccountType.MANAGER],
  },
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; action: string }> },
) {
  const { id, action } = await params;
  const entry = ACTIONS[action];
  // A name outside the lifecycle set is indistinguishable from a missing route.
  if (!entry) {
    return toNextResponse({
      success: false as const,
      statusCode: 404,
      error: 'NOT_FOUND' as const,
    });
  }

  return withAuth(
    req,
    async (ctx) => {
      const body: unknown = await req.json().catch(() => null);
      return toNextResponse(await entry.run(id, body, ctx));
    },
    { allowedAccountTypes: entry.allowedAccountTypes },
  );
}
