import { AppError } from '@studiq/server/lib/errors';
import { handleApiError, toNextResponse } from '@studiq/server/lib/http-utils';
import { withAuth } from '@studiq/server/lib/with-auth';
import { MAX_REQUEST_BYTES, storageService } from '@studiq/server/services/storage.service';
import type { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  return withAuth(req, async (ctx) => {
    // The proxy buffers the body before this route runs; reject oversize
    // requests up front instead of letting a truncated multipart body fail
    // later as a 500 (#185).
    const contentLength = Number(req.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
      return handleApiError(new AppError('PAYLOAD_TOO_LARGE'));
    }

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch (error) {
      // Malformed or truncated multipart body — a client error, not a 500.
      return handleApiError(error, 'BAD_REQUEST');
    }

    const file = formData.get('file') as File | null;

    if (!file) {
      return toNextResponse({ success: false, statusCode: 400, error: 'BAD_REQUEST' });
    }

    const result = await storageService.uploadFile(ctx.userId, file);
    return toNextResponse({ success: true, statusCode: 200, data: result });
  });
}
