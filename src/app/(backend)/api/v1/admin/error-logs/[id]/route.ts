import { NextRequest } from 'next/server';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { UserRole } from '@/types';
import { errorLogController } from '@/server/controllers';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(req, async () => {
    const { id } = await params;
    const response = await errorLogController.getById(id);
    return toNextResponse(response);
  }, { allowedRoles: [UserRole.SYS_ADMIN] });
}
