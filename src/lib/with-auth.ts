import type { NextRequest, NextResponse } from 'next/server';
import { AppError } from '@/lib/errors';
import { toNextResponse } from '@/lib/http-utils';
import { log } from '@/lib/logger';
import type { RequestContext } from '@/lib/request-context';
import { createClient } from '@/lib/supabase/server';
import { errorLogService } from '@/server/services';
import type { AccountType } from '@/types';

export interface WithAuthOptions {
  allowedAccountTypes?: AccountType[];
}

export async function withAuth(
  req: NextRequest,
  handler: (ctx: RequestContext) => Promise<NextResponse>,
  options?: WithAuthOptions,
): Promise<NextResponse> {
  const t0 = performance.now();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return toNextResponse({ success: false, statusCode: 401, error: 'UNAUTHORIZED' });
  }

  const traceId = crypto.randomUUID();
  const accountType = user.app_metadata?.account_type as AccountType;
  const cookieOrgId = req.cookies.get('active_org_id')?.value ?? null;
  let orgRoleId: string | null = null;

  if (cookieOrgId) {
    const { data: membership } = await supabase
      .from('org_members')
      .select('org_role_id')
      .eq('organization_id', cookieOrgId)
      .eq('user_id', user.id)
      .maybeSingle();
    orgRoleId = membership?.org_role_id ?? null;
  }

  if (options?.allowedAccountTypes && !options.allowedAccountTypes.includes(accountType)) {
    return toNextResponse({ success: false, statusCode: 403, error: 'FORBIDDEN' });
  }

  const ctx: RequestContext = {
    traceId,
    userId: user.id,
    accountType,
    orgRoleId,
    activeOrgId: cookieOrgId,
    url: req.url,
    method: req.method,
  };

  log.api.info('request', {
    metadata: { traceId, method: req.method, url: req.url, userId: user.id },
  });

  try {
    const res = await handler(ctx);
    log.api.info('response', {
      metadata: { traceId, status: res.status },
      durationMs: performance.now() - t0,
    });
    return res;
  } catch (error) {
    log.api.error('error', {
      metadata: { traceId, error: String(error) },
      durationMs: performance.now() - t0,
    });
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

    if (error instanceof SyntaxError) {
      return toNextResponse({ success: false, statusCode: 400, error: 'BAD_REQUEST' });
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
