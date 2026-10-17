import { context, SpanStatusCode, trace } from '@opentelemetry/api';
import type { AccountType, PermissionScope, RequestContext } from '@studiq/authz';
import { AppError } from '@studiq/server/lib/errors';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { error as logError, warn as logWarn } from '@studiq/server/lib/log';
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
export const ERROR_CODE_HEADER = 'x-error-code';

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

  // Real trace id from the span — returned in `x-trace-id` and used to look the
  // request up in Tempo.
  const traceId = span.spanContext().traceId;
  const metricLabels = { 'http.method': req.method };
  const t0 = performance.now();
  let statusCode = 500;

  activeRequests.add(1, metricLabels);

  // Settle a response: tag the trace id, set the span status from the HTTP
  // status, and emit a log for failures so 4xx/5xx land in Loki with the
  // trace_id (previously only thrown errors were logged — see #142).
  const settle = (
    response: NextResponse | Response,
    status: number,
    extraAttributes: Record<string, unknown> = {},
    exception?: unknown,
  ): NextResponse | Response => {
    statusCode = status;
    span.setAttribute('http.status_code', statusCode);

    const err =
      exception === undefined
        ? null
        : exception instanceof Error
          ? exception
          : new Error(String(exception));
    if (err) span.recordException(err);

    span.setStatus(
      statusCode >= 400
        ? {
            code: SpanStatusCode.ERROR,
            message: err ? `HTTP ${statusCode}: ${err.message}` : `HTTP ${statusCode}`,
          }
        : { code: SpanStatusCode.OK },
    );

    if (statusCode >= 400) {
      const errorCode = response.headers.get(ERROR_CODE_HEADER);
      const attributes = {
        'http.method': req.method,
        'http.url': req.url,
        'http.status_code': statusCode,
        ...(errorCode ? { 'error.code': errorCode } : {}),
        ...extraAttributes,
      };
      const message = `API error ${statusCode}${errorCode ? ` ${errorCode}` : ''}`;
      if (statusCode >= 500) logError(message, attributes);
      else logWarn(message, attributes);
    }

    return attachTraceId(response, traceId);
  };

  try {
    // Run the whole request inside the span context so every response (including
    // early returns and the catch block) can be logged with this trace_id.
    return await context.with(trace.setSpan(context.active(), span), async () => {
      try {
        const supabase = await createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          return settle(
            toNextResponse({ success: false, statusCode: 401, error: 'UNAUTHORIZED' }),
            401,
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
          return settle(
            toNextResponse({ success: false, statusCode: 403, error: 'FORBIDDEN' }),
            403,
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

        const res = await handler(ctx);
        return settle(res, res.status);
      } catch (error) {
        if (error instanceof AppError) {
          return settle(
            toNextResponse({ success: false, statusCode: error.statusCode, error: error.code }),
            error.statusCode,
            {},
            error,
          );
        }

        if (error instanceof SyntaxError) {
          return settle(
            toNextResponse({ success: false, statusCode: 400, error: 'BAD_REQUEST' }),
            400,
            {},
            error,
          );
        }

        return settle(
          toNextResponse({ success: false, statusCode: 500, error: 'INTERNAL_SERVER' }),
          500,
          { error },
          error,
        );
      }
    });
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
