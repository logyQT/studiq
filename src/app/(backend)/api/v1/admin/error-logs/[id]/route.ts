import { NextRequest } from 'next/server';
import { errorLogService } from '@/server/services/error-log.service';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { UserRole } from '@/types';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuth(
    req,
    async () => {
      const { id } = await params;
      const entry = await errorLogService.getById(id);

      if (!entry) {
        return toNextResponse({ success: false, statusCode: 404, error: 'NOT_FOUND' });
      }

      return toNextResponse({ success: true, statusCode: 200, data: entry });
    },
    { allowedRoles: [UserRole.SYS_ADMIN] },
  );
}
