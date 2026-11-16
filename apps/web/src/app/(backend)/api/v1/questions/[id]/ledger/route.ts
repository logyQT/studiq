import { AccountType } from '@studiq/authz';
import { questionController } from '@studiq/server/controllers/question.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

/**
 * The staff ledger of one item (R8): who the system showed its key to, when, and with which
 * classes. Staff-only at the route and again at the staff key permission inside the service; a
 * student is refused and the payload carries no key field.
 */
export const GET = (req: NextRequest, { params }: { params: Promise<{ id: string }> }) =>
  withAuth(
    req,
    async (ctx) => toNextResponse(await questionController.ledger((await params).id, ctx)),
    { allowedAccountTypes: [AccountType.EDUCATOR, AccountType.MANAGER] },
  );
