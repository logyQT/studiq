import type { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { planFeatureController } from '@/server/controllers/plan-feature.controller';

import { AccountType } from '@/types';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withAuth(
    req,
    async () => {
      const response = await planFeatureController.delete(id);
      return toNextResponse(response);
    },
    { allowedAccountTypes: [AccountType.SYS_ADMIN] },
  );
}
