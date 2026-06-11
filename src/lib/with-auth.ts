import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { toNextResponse } from '@/lib/http-utils';
import { AppError } from '@/lib/errors';
import { errorLogService } from '@/server/services';
import type { RequestContext } from '@/lib/request-context';
import { UserRole } from '@/types';

export interface WithAuthOptions {
  allowedRoles?: UserRole[];
}

export async function withAuth(
  req: NextRequest,
  handler: (ctx: RequestContext) => Promise<NextResponse>,
  options?: WithAuthOptions,
): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return toNextResponse({ success: false, statusCode: 401, error: 'UNAUTHORIZED' });
  }

  const role = user.app_metadata?.role as UserRole;

  if (options?.allowedRoles && !options.allowedRoles.includes(role)) {
    return toNextResponse({ success: false, statusCode: 403, error: 'FORBIDDEN' });
  }

  const ctx: RequestContext = {
    userId: user.id,
    universityId: user.app_metadata?.university_id ?? null,
    role,
    url: req.url,
    method: req.method,
  };

  try {
    return await handler(ctx);
  } catch (error) {
    if (error instanceof AppError) {
      if (error.code === 'INTERNAL_SERVER') {
        const errorId = await errorLogService.logError(error, error.code, ctx);
        console.error(`[AppError INTERNAL_SERVER] errorId=${errorId}:`, error);
        return toNextResponse({
          success: false,
          statusCode: error.statusCode,
          error: error.code,
          errorId,
        });
      }
      return toNextResponse({
        success: false,
        statusCode: error.statusCode,
        error: error.code,
      });
    }

    const errorId = await errorLogService.logError(error, 'INTERNAL_SERVER', ctx);
    console.error(`[Unhandled API Error] errorId=${errorId}:`, error);

    return toNextResponse({
      success: false,
      statusCode: 500,
      error: 'INTERNAL_SERVER',
      errorId,
    });
  }
}
