import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { seatController } from '@/server/controllers/seat.controller';

import { AccountType } from '@/types';

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
