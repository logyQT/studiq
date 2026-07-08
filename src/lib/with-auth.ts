import { context, SpanStatusCode, trace } from '@opentelemetry/api';
import type { NextRequest, NextResponse } from 'next/server';
import { AppError } from '@/lib/errors';
import { toNextResponse } from '@/lib/http-utils';
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
  const tracer = trace.getTracer('api');
  const span = tracer.startSpan(`${req.method} /api/**`, {
    attributes: {
      'http.method': req.method,
      'http.url': req.url,
    },
  });

  const t0 = performance.now();
  let ctx: RequestContext | undefined;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      span.setAttribute('http.status_code', 401);
      span.setStatus({ code: SpanStatusCode.ERROR });
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
      span.setAttribute('http.status_code', 403);
      span.setStatus({ code: SpanStatusCode.ERROR });
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

    span.setAttributes({
      'user.id': user.id,
      'user.account_type': accountType,
    });

    const res = await context.with(trace.setSpan(context.active(), span), () => handler(ctx));

    span.setAttribute('http.status_code', res.status);
    span.setStatus({ code: SpanStatusCode.OK });

    return res;
  } catch (error) {
    span.setAttribute('http.status_code', 500);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : String(error),
    });
    span.recordException(error instanceof Error ? error : new Error(String(error)));

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
  } finally {
    span.setAttribute('duration.ms', performance.now() - t0);
    span.end();
  }
}
