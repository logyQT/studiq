import { context, SpanStatusCode, trace } from '@opentelemetry/api';
import type { AccountType, PermissionScope, RequestContext } from '@studiq/authz';
import { AppError } from '@studiq/server/lib/errors';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { error as logError } from '@studiq/server/lib/log';
import {
  activeRequests,
  httpRequestDuration,
  httpRequestTotal,
} from '@studiq/server/lib/observability';
import { createClient } from '@studiq/server/lib/supabase/server';
import type { NextRequest, NextResponse } from 'next/server';

export interface WithAuthOptions {
  allowedAccountTypes?: AccountType[];
}

export const TRACE_ID_HEADER = 'x-trace-id';

/** Every response gets the active trace id so a browser request maps to a Tempo trace. */
function attachTraceId(
  response: NextResponse | Response,
  traceId: string,
): NextResponse | Response {
  response.headers.set(TRACE_ID_HEADER, traceId);
  return response;
}

export async function withAuth(
  req: NextRequest,
  handler: (ctx: RequestContext) => Promise<NextResponse | Response>,
  options?: WithAuthOptions,
): Promise<NextResponse | Response> {
  const tracer = trace.getTracer('api');
  const span = tracer.startSpan(`${req.method} /api/**`, {
    attributes: {
      'http.method': req.method,
      'http.url': req.url,
    },
  });

  // Real trace id from the span (was previously a random UUID) — this is the
  // value returned in `x-trace-id` and used to look the request up in Tempo.
  const traceId = span.spanContext().traceId;
  const metricLabels = { 'http.method': req.method };
  const t0 = performance.now();
  let statusCode = 500;

  activeRequests.add(1, metricLabels);

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      statusCode = 401;
      span.setAttribute('http.status_code', statusCode);
      span.setStatus({ code: SpanStatusCode.ERROR });
      return attachTraceId(
        toNextResponse({ success: false, statusCode, error: 'UNAUTHORIZED' }),
        traceId,
      );
    }

    const accountType = user.app_metadata?.account_type as AccountType;
    const cookieOrgId = req.cookies.get('active_org_id')?.value ?? null;
    let orgRoleId: string | null = null;
    let groupIds: string[] = [];
    const permissionScopes: Partial<Record<string, PermissionScope>> = {};

    if (cookieOrgId) {
      const [membershipResult, groupsResult] = await Promise.all([
        supabase
          .from('org_members')
          .select('org_role_id')
          .eq('organization_id', cookieOrgId)
          .eq('user_id', user.id)
          .maybeSingle(),
        supabase.from('group_members').select('group_id').eq('user_id', user.id),
      ]);

      orgRoleId = membershipResult.data?.org_role_id ?? null;
      groupIds = (groupsResult.data ?? []).map((r) => r.group_id);

      if (orgRoleId) {
        const { data: perms } = await supabase
          .from('org_role_permissions')
          .select('permission_name, scope')
          .eq('org_role_id', orgRoleId);

        for (const row of perms ?? []) {
          permissionScopes[row.permission_name] = row.scope as PermissionScope;
        }
      }
    }

    if (options?.allowedAccountTypes && !options.allowedAccountTypes.includes(accountType)) {
      statusCode = 403;
      span.setAttribute('http.status_code', statusCode);
      span.setStatus({ code: SpanStatusCode.ERROR });
      return attachTraceId(
        toNextResponse({ success: false, statusCode, error: 'FORBIDDEN' }),
        traceId,
      );
    }

    const ctx: RequestContext = {
      traceId,
      userId: user.id,
      accountType,
      orgRoleId,
      activeOrgId: cookieOrgId,
      url: req.url,
      method: req.method,
      groupIds,
      permissionScopes,
    };

    span.setAttributes({
      'user.id': user.id,
      'user.account_type': accountType,
    });

    const res = await context.with(trace.setSpan(context.active(), span), () => handler(ctx));

    statusCode = res.status;
    span.setAttribute('http.status_code', statusCode);
    span.setStatus({ code: SpanStatusCode.OK });

    return attachTraceId(res, traceId);
  } catch (error) {
    statusCode =
      error instanceof AppError ? error.statusCode : error instanceof SyntaxError ? 400 : 500;

    span.setAttribute('http.status_code', statusCode);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : String(error),
    });
    span.recordException(error instanceof Error ? error : new Error(String(error)));

    if (error instanceof AppError) {
      return attachTraceId(
        toNextResponse({ success: false, statusCode, error: error.code }),
        traceId,
      );
    }

    if (error instanceof SyntaxError) {
      return attachTraceId(
        toNextResponse({ success: false, statusCode: 400, error: 'BAD_REQUEST' }),
        traceId,
      );
    }

    // Emit inside the span context so the Loki record carries this trace_id.
    context.with(trace.setSpan(context.active(), span), () => {
      logError('Unhandled API error', {
        'http.method': req.method,
        'http.url': req.url,
        error,
      });
    });

    return attachTraceId(
      toNextResponse({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' }),
      traceId,
    );
  } finally {
    const duration = performance.now() - t0;
    span.setAttribute('duration.ms', duration);
    httpRequestDuration.record(duration, {
      'http.method': req.method,
      'http.status_code': statusCode,
    });
    httpRequestTotal.add(1, {
      'http.method': req.method,
      'http.status_code': statusCode,
    });
    activeRequests.add(-1, metricLabels);
    span.end();
  }
}
