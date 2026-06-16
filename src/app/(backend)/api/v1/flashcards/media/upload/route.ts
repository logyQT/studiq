import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/with-auth';
import { storageService } from '@/server/services/storage.service';
import { toNextResponse } from '@/lib/http-utils';

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
