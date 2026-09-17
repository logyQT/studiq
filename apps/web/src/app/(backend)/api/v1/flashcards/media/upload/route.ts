import { toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import { storageService } from '@studiq/server/services/storage.service';
import type { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return toNextResponse({ success: false, statusCode: 400, error: 'BAD_REQUEST' });
    }

    const result = await storageService.uploadFile(ctx.userId, file);
    return toNextResponse({ success: true, statusCode: 200, data: result });
  });
}
