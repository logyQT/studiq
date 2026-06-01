import { NextRequest } from 'next/server';
import { errorLogService } from '@/server/services/error-log.service';
import { toNextResponse } from '@/lib/http-utils';
import { withAuth } from '@/lib/with-auth';
import { UserRole } from '@/types';

export async function GET(req: NextRequest) {
  return withAuth(
    req,
    async () => {
      const { searchParams } = new URL(req.url);
      const search = searchParams.get('search') ?? undefined;
      const errorCode = searchParams.get('errorCode') ?? undefined;
      const limit = parseInt(searchParams.get('limit') ?? '50', 10);
      const offset = parseInt(searchParams.get('offset') ?? '0', 10);

      const result = await errorLogService.list({ search, errorCode, limit, offset });

      return toNextResponse({ success: true, statusCode: 200, data: result });
    },
    { allowedRoles: [UserRole.SYS_ADMIN] },
  );
}
