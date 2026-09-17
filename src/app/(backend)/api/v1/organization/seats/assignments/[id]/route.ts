import { AccountType } from '@studiq/authz';
import { seatController } from '@studiq/server/controllers/seat.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { NextRequest } from 'next/server';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(
    req,
    async (ctx) => {
      const { id } = await params;
      return toNextResponse(await seatController.unassignSeat(ctx, id));
    },
    { allowedAccountTypes: [AccountType.MANAGER] },
  );
}
